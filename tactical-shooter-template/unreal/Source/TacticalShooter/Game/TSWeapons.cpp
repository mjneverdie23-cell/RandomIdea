#include "Game/TSWeapons.h"
#include "Game/TSCharacter.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"

namespace
{
	const FTSGameData& WeaponData(const ATSCharacter* C) { return UTSGameSubsystem::Get(C)->Data(); }
}

// ------------------------------------------------------------------------------- weapons

void FTSWeaponHandler::SetLoadout(const FTSLoadout& Lo)
{
	const FTSGameData& D = WeaponData(Owner);
	const FTSWeaponDef* Primary = Lo.PrimaryId.IsEmpty() ? nullptr : D.Weapon(Lo.PrimaryId);
	const FTSWeaponDef* Secondary = Lo.SecondaryId.IsEmpty() ? nullptr : D.Weapon(Lo.SecondaryId);
	Slots[0] = FTSWeaponInstance(Primary);
	Slots[1] = FTSWeaponInstance(Secondary ? Secondary : D.DefaultSecondary());
	Slots[2] = FTSWeaponInstance(D.DefaultMelee());
	ShotIndex = 0;
	Cooldown = 0.f;
	Select(Slots[0].IsValid() ? 0 : 1, true, true);
}

FTSWeaponInstance FTSWeaponHandler::Replace(const FTSWeaponInstance& Weapon, bool bSelect)
{
	const int32 Slot = (int32)Weapon.Def->GetSlot();
	const FTSWeaponInstance Old = Slots[Slot];
	Slots[Slot] = Weapon;
	if (bSelect) Select(Slot, false, true);
	else if (Slot == CurrentSlot) Select(Slot, true, true);
	return Old;
}

FTSWeaponInstance FTSWeaponHandler::Remove(ETSWeaponSlot Slot)
{
	const FTSWeaponInstance Old = Slots[(int32)Slot];
	Slots[(int32)Slot] = FTSWeaponInstance();
	if (CurrentSlot == (int32)Slot) SelectBest();
	return Old;
}

void FTSWeaponHandler::SelectBest()
{
	for (int32 S = 0; S < 3; ++S)
	{
		if (Slots[S].IsValid())
		{
			Select(S, false, true);
			return;
		}
	}
}

void FTSWeaponHandler::Select(int32 Slot, bool bInstant, bool bForce)
{
	if (Slot < 0 || Slot > 2 || !Slots[Slot].IsValid()) return;
	if (Slot == CurrentSlot && !bInstant && !bForce) return;
	CurrentSlot = Slot;
	const FTSWeaponDef* Def = Slots[Slot].Def;
	EquipTimeLeft = bInstant ? 0.f : Def->EquipSeconds;
	ReloadTimeLeft = 0.f;
	bAiming = false;
	ShotIndex = 0;
	Owner->SetWeaponVisual(Def);
	if (!bInstant) Owner->Mode->PlaySound(TEXT("equip"), Owner->EyePosition(), 0.6f);
}

float FTSWeaponHandler::ComputeSpread(const FTSWeaponDef& W) const
{
	FTSSpreadInput In;
	In.HorizontalSpeed = Owner->HorizontalSpeedMetres();
	In.bAirborne = !Owner->IsGrounded();
	In.bCrouched = Owner->IsCrouchedNow();
	In.bAiming = bAiming;
	In.ShotIndex = ShotIndex;
	return TSWeaponMath::Spread(W, WeaponData(Owner).Game.Movement, In);
}

void FTSWeaponHandler::Tick(const FTSIntent& Intent, float Dt)
{
	const float Now = Owner->Mode->MatchTime;
	if (Intent.SelectSlot >= 0) Select(Intent.SelectSlot);
	if (!Current().IsValid()) SelectBest();
	if (!Current().IsValid()) return;
	const FTSWeaponDef& W = *CurrentDef();

	if (EquipTimeLeft > 0.f) EquipTimeLeft -= Dt;
	if (Cooldown > 0.f) Cooldown -= Dt;
	if (ReloadTimeLeft > 0.f)
	{
		ReloadTimeLeft -= Dt;
		if (ReloadTimeLeft <= 0.f) FinishReload();
	}
	if (Intent.bReload) StartReload();

	const bool bBlocked = Owner->bFrozen || Owner->bInteractLock;
	bAiming = Intent.bAim && W.HasAds() && EquipTimeLeft <= 0.f && !IsReloading() && !bBlocked;
	AimTime = bAiming ? AimTime + Dt : 0.f;
	if (Now - LastShotTime > W.RecoilResetSeconds) ShotIndex = 0;

	const bool bPressed = Intent.bFire && !bTriggerHeld;
	bTriggerHeld = Intent.bFire;
	const bool bWantsToFire = W.GetMode() == ETSFireMode::Auto ? Intent.bFire : bPressed;
	if (bWantsToFire && !bBlocked && EquipTimeLeft <= 0.f && Cooldown <= 0.f)
	{
		if (W.GetMode() == ETSFireMode::Melee) Swing();
		else if (IsReloading()) {}
		else if (Current().Mag > 0) Shoot();
		else
		{
			if (bPressed) Owner->Mode->PlaySound(TEXT("dry_fire"), Owner->EyePosition());
			StartReload();
		}
	}
	if (W.MagazineSize > 0 && Current().Mag == 0 && Current().Reserve > 0 && !IsReloading() && !Intent.bFire) StartReload();

	const float Interval = TSWeaponMath::FireInterval(W, Owner->FireRateMultiplier);
	if (Now - LastShotTime > Interval + 0.05f)
	{
		Owner->RecoilPitch = FMath::FInterpConstantTo(Owner->RecoilPitch, 0.f, Dt, W.RecoilRecovery);
		Owner->RecoilYaw = FMath::FInterpConstantTo(Owner->RecoilYaw, 0.f, Dt, W.RecoilRecovery);
	}
	CurrentSpread = ComputeSpread(W);
}

void FTSWeaponHandler::Shoot()
{
	const FTSWeaponDef& W = *CurrentDef();
	ATSGameMode* Mode = Owner->Mode;
	Current().Mag--;
	const float Spread = ComputeSpread(W);
	const FVector Eye = Owner->EyePosition();
	const FVector Muzzle = Eye + Owner->AimForward() * 60.f + Owner->GetActorRightVector() * 18.f - FVector(0.f, 0.f, 12.f);
	const int32 Pellets = FMath::Max(1, W.Pellets);
	for (int32 P = 0; P < Pellets; ++P)
	{
		float DPitch, DYaw;
		TSWeaponMath::SampleCone(Owner->Rng, Spread, DPitch, DYaw);
		const FVector Dir = FRotator(Owner->ViewPitch() + DPitch, Owner->ViewYaw() + DYaw, 0.f).Vector();
		const FVector End = Mode->Combat.FireBullet(Owner, Eye, Dir, W);
		if (P < 3) Mode->Effects.Tracer(Muzzle, End);
	}
	float KickPitch, KickYaw;
	TSWeaponMath::RecoilKick(W, ShotIndex, KickPitch, KickYaw);
	KickYaw += Owner->Rng.Range(-W.RecoilRandomYaw, W.RecoilRandomYaw);
	Owner->RecoilPitch += KickPitch;
	Owner->RecoilYaw += KickYaw;
	ShotIndex++;
	ShotsFired++;
	LastShotTime = Mode->MatchTime;
	Cooldown = TSWeaponMath::FireInterval(W, Owner->FireRateMultiplier);
	Mode->PlaySound(W.FireSound, Eye);
	Mode->Effects.MuzzleFlash(Muzzle);
	Owner->RecordNoise(Eye);
}

void FTSWeaponHandler::Swing()
{
	const FTSWeaponDef& W = *CurrentDef();
	Cooldown = TSWeaponMath::FireInterval(W, Owner->FireRateMultiplier);
	LastShotTime = Owner->Mode->MatchTime;
	ShotsFired++;
	Owner->Mode->PlaySound(W.FireSound, Owner->EyePosition());
	Owner->Mode->Combat.Melee(Owner, W);
}

void FTSWeaponHandler::StartReload()
{
	const FTSWeaponInstance& C = Current();
	if (!C.IsValid() || C.Def->MagazineSize <= 0 || IsReloading() || C.Mag >= C.Def->MagazineSize || C.Reserve <= 0 || EquipTimeLeft > 0.f) return;
	ReloadTimeLeft = C.Def->ReloadSeconds;
	bAiming = false;
	Owner->Mode->PlaySound(TEXT("reload"), Owner->EyePosition());
}

void FTSWeaponHandler::FinishReload()
{
	ReloadTimeLeft = 0.f;
	FTSWeaponInstance& C = Current();
	const int32 Take = FMath::Min(C.Def->MagazineSize - C.Mag, C.Reserve);
	C.Mag += Take;
	C.Reserve -= Take;
}

// ------------------------------------------------------------------------------ abilities

int32 FTSAbilityHandler::SlotCount() const
{
	return Owner->Agent ? Owner->Agent->Abilities.Num() : 0;
}

const FTSAgentAbilitySlot* FTSAbilityHandler::Slot(int32 Index) const
{
	return Owner->Agent && Owner->Agent->Abilities.IsValidIndex(Index) ? &Owner->Agent->Abilities[Index] : nullptr;
}

const FTSAbilityDef* FTSAbilityHandler::Def(int32 Index) const
{
	const FTSAgentAbilitySlot* S = Slot(Index);
	return S ? WeaponData(Owner).Ability(S->AbilityId) : nullptr;
}

int32 FTSAbilityHandler::Charges(int32 Index) const
{
	return Index >= 0 && Index < 4 ? Owner->Record->Loadout.AbilityCharges[Index] : 0;
}

bool FTSAbilityHandler::IsReady(int32 Index) const
{
	const FTSAgentAbilitySlot* S = Slot(Index);
	if (S == nullptr) return false;
	return S->IsUltimate() ? Owner->Record->UltPoints >= S->UltPoints : Charges(Index) > 0;
}

int32 FTSAbilityHandler::FindReady(ETSAbilityType Type) const
{
	for (int32 i = 0; i < SlotCount(); ++i)
	{
		const FTSAbilityDef* D = Def(i);
		if (D != nullptr && D->GetType() == Type && IsReady(i)) return i;
	}
	return -1;
}

void FTSAbilityHandler::Tick(const FTSIntent& Intent, float Dt)
{
	if (Cooldown > 0.f) Cooldown -= Dt;
	if (Intent.UseAbility >= 0) TryUse(Intent.UseAbility);
}

bool FTSAbilityHandler::TryUse(int32 Index)
{
	if (Owner->bFrozen || Owner->bInteractLock || Cooldown > 0.f || !IsReady(Index)) return false;
	const FTSAgentAbilitySlot* S = Slot(Index);
	const FTSAbilityDef* A = Def(Index);
	if (S == nullptr || A == nullptr) return false;
	if (S->IsUltimate()) Owner->Record->UltPoints = 0;
	else Owner->Record->Loadout.AbilityCharges[Index]--;
	Cooldown = WeaponData(Owner).Game.Combat.AbilityCooldownSeconds;
	Execute(*A, S->IsUltimate());
	return true;
}

void FTSAbilityHandler::Execute(const FTSAbilityDef& A, bool bUltimate)
{
	ATSGameMode* Mode = Owner->Mode;
	if (bUltimate) Mode->PlaySound(TEXT("ultimate"), Owner->EyePosition());
	switch (A.GetType())
	{
	case ETSAbilityType::Flash:
	case ETSAbilityType::Smoke:
	case ETSAbilityType::Frag:
	case ETSAbilityType::Incendiary:
	{
		const FVector Dir = Owner->AimForward();
		const FVector Start = Owner->EyePosition() + Dir * 50.f;
		const FVector Vel = Owner->GetVelocity();
		// Velocities in metres per second, like the config.
		const FVector Velocity = Dir * A.ThrowSpeed + FVector(0.f, 0.f, 2.f) + FVector(Vel.X, Vel.Y, 0.f) * 0.005f;
		Mode->Effects.Throw(Owner, A, Start, Velocity);
		Mode->PlaySound(TEXT("ability_throw"), Owner->EyePosition());
		break;
	}
	case ETSAbilityType::Dash:
		Owner->StartDash(A);
		Mode->PlaySound(TEXT("dash"), Owner->Feet());
		break;
	case ETSAbilityType::Heal:
		Owner->StartHeal(A);
		Mode->PlaySound(TEXT("heal"), Owner->Feet());
		break;
	case ETSAbilityType::Wall:
		Mode->Effects.SpawnBarrier(Owner, A);
		Mode->PlaySound(TEXT("barrier"), Owner->Feet());
		break;
	case ETSAbilityType::Recon:
		Mode->Effects.Recon(Owner, A);
		Mode->PlaySound(TEXT("recon"), Owner->Feet());
		break;
	case ETSAbilityType::Buff:
		Owner->ApplyBuff(A);
		break;
	}
}
