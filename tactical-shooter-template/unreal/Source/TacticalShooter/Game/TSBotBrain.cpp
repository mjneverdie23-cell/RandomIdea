#include "Game/TSBotBrain.h"
#include "Game/TSCharacter.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"

namespace
{
	/** Yaw (degrees) of a horizontal direction; Unreal yaw 0 = +X (north). */
	float YawOf(const FVector& Dir) { return FMath::RadiansToDegrees(FMath::Atan2((float)Dir.Y, (float)Dir.X)); }
	float PitchOf(const FVector& Dir) { return FMath::RadiansToDegrees(FMath::Atan2((float)Dir.Z, (float)Dir.Size2D())); }
	float MoveTowardsAngle(float Current, float Target, float MaxDelta)
	{
		const float Delta = FMath::FindDeltaAngleDegrees(Current, Target);
		return Current + FMath::Clamp(Delta, -MaxDelta, MaxDelta);
	}
}

// --------------------------------------------------------------------------------- team plan

void FTSTeamPlan::OnRoundStart(ATSGameMode* Mode)
{
	const FTSWorldMap& World = Mode->World;
	const bool bA = World.HasSite(0), bB = World.HasSite(1);
	AttackSite = bA && bB ? Mode->Rng.RangeInt(0, 2) : (bA ? 0 : 1);
	BombSite = -1;
	DefenderSpots.Reset();
	ViaMid.Reset();
	const FTSBotBehaviourSettings& Beh = UTSGameSubsystem::Get(Mode)->Data().Bots.Behaviour;
	int32 DefenderIndex = 0;
	for (const FTSPlayerRecord& P : Mode->Players)
	{
		if (!P.bIsBot) continue;
		if (Mode->Flow.SideOf(P.Team) == ETSSide::Defense)
		{
			const int32 Site = bA && bB ? DefenderIndex++ % 2 : (bA ? 0 : 1);
			DefenderSpots.Add(P.Id, PickSpotNear(Mode, World.SiteCenter(Site), Beh.HoldRadiusCells));
		}
		else if (Mode->Rng.Chance(Beh.MidRouteChance))
		{
			ViaMid.Add(P.Id);
		}
	}
}

FTSCell FTSTeamPlan::DefenderSpot(ATSGameMode* Mode, int32 Id)
{
	if (const FTSCell* Found = DefenderSpots.Find(Id)) return *Found;
	const FTSCell Spot = PickSpotNear(Mode, Mode->World.SiteCenter(0), 4);
	DefenderSpots.Add(Id, Spot);
	return Spot;
}

FTSCell FTSTeamPlan::PickSpotNear(ATSGameMode* Mode, const FVector& Point, int32 Radius)
{
	const FTSWorldMap& World = Mode->World;
	const FTSCell Center = World.Nav.NearestWalkable(World.WorldToCell(Point));
	TArray<FTSCell> Options;
	for (int32 DY = -Radius; DY <= Radius; ++DY)
		for (int32 DX = -Radius; DX <= Radius; ++DX)
		{
			const FTSCell C(Center.X + DX, Center.Y + DY);
			if (DX * DX + DY * DY > Radius * Radius || !World.Nav.IsWalkable(C)) continue;
			if (World.Nav.ClearLine(C, Center)) Options.Add(C);
		}
	return Options.Num() > 0 ? Options[Mode->Rng.RangeInt(0, Options.Num())] : Center;
}

// ----------------------------------------------------------------------------------- brain

FTSBotBrain::FTSBotBrain(ATSGameMode* InMode, ATSCharacter* InSelf, const FTSBotDifficulty& InDiff)
	: Mode(InMode), Self(InSelf), Diff(InDiff), Rng(InMode->Seed ^ (uint32)(InSelf->Id() * 104729 + 17))
{
	Beh = UTSGameSubsystem::Get(InMode)->Data().Bots.Behaviour;
}

FString FTSBotBrain::DebugTask() const
{
	static const TCHAR* Names[] = { TEXT("Hold"), TEXT("Move"), TEXT("Plant"), TEXT("Defuse"), TEXT("Fetch"), TEXT("Guard") };
	return FString(Names[(int32)Task]) + (Target ? FString(TEXT(" -> ")) + Target->Record->Name : FString());
}

void FTSBotBrain::OnSpawn()
{
	Yaw = Self->Yaw;
	Pitch = 0.f;
	HoldYaw = Yaw;
	Target = nullptr;
	LastKnownTime = -99.f;
	bHasGoal = bHasVia = bArrived = false;
	CellPath.Reset();
	Waypoints.Reset();
	Task = ETask::Move;
	DecisionTimer = Rng.Range(0.f, Beh.DecisionJitterSeconds);
	AbilityTimer = Rng.Range(1.f, 3.f);
	ProgressPos = Self->Feet();
	ProgressTimer = 0.f;
	BurstFired = 0;
	LastShotsFired = Self->Weapons.ShotsFired;
}

FTSIntent FTSBotBrain::Think(float Dt)
{
	const ETSMatchPhase Phase = Mode->Flow.Phase;
	if (Phase != ETSMatchPhase::Live)
	{
		// Round end / halftime: no objectives, but shoot back at anyone in sight, so the
		// seconds before the next round are not free kills. Buy phase: look around.
		if (Phase == ETSMatchPhase::RoundEnd || Phase == ETSMatchPhase::Halftime)
		{
			Perceive(Dt);
			if (Target != nullptr)
			{
				FTSIntent Defend = FTSIntent::Idle(Yaw, Pitch);
				FVector DefendMove = FVector::ZeroVector;
				Aim(Dt);
				Fight(Dt, Defend, DefendMove);
				ManageWeapons(Defend);
				ToMoveIntent(DefendMove, Defend);
				Defend.Yaw = Yaw;
				Defend.Pitch = Pitch;
				return Defend;
			}
		}
		Yaw = MoveTowardsAngle(Yaw, HoldYaw, 60.f * Dt);
		return FTSIntent::Idle(Yaw, Pitch);
	}
	FTSIntent Intent = FTSIntent::Idle(Yaw, Pitch);
	Perceive(Dt);
	DecisionTimer -= Dt;
	if (DecisionTimer <= 0.f)
	{
		Decide();
		DecisionTimer = Beh.RepathSeconds;
	}

	FVector MoveDir = FVector::ZeroVector;
	bool bInteract = false;
	const FTSBombSystem& Bomb = Mode->Bomb;
	if (Task == ETask::Plant && Self->bCarryingBomb && Mode->World.SiteAt(Self->Feet()) >= 0 && Target == nullptr)
	{
		bInteract = true;
	}
	else if (Task == ETask::Defuse && FVector::DistSquared2D(Self->Feet(), Bomb.Position) < FMath::Square(120.f) && (Target == nullptr || MustDefuseNow()))
	{
		bInteract = true;
	}
	else if (Target == nullptr || Task == ETask::Fetch)
	{
		MoveDir = FollowPath(Dt);
		// The path ends at a cell centre; walk the last metre to the bomb itself.
		if (MoveDir.IsNearlyZero() && (Task == ETask::Defuse || Task == ETask::Fetch))
		{
			const FVector D = FVector(Bomb.Position.X - Self->Feet().X, Bomb.Position.Y - Self->Feet().Y, 0.f);
			if (D.Size() > 60.f) MoveDir = D.GetSafeNormal();
		}
	}

	if (Target != nullptr)
	{
		Aim(Dt);
		Fight(Dt, Intent, MoveDir);
	}
	else
	{
		Look(Dt, MoveDir);
	}
	UseAbilities(Dt, Intent);
	ManageWeapons(Intent);

	if (bInteract)
	{
		Intent.bInteract = true;
		MoveDir = FVector::ZeroVector;
	}
	ToMoveIntent(MoveDir, Intent);
	Intent.bJump = bJumpNext;
	bJumpNext = false;
	Intent.Yaw = Yaw;
	Intent.Pitch = Pitch;
	return Intent;
}

bool FTSBotBrain::MustDefuseNow() const
{
	const FTSBombSettings& S = UTSGameSubsystem::Get(Mode)->Data().Game.Bomb;
	const float Need = Self->Record->Loadout.bHasDefuseKit ? S.DefuseKitSeconds : S.DefuseSeconds;
	return Mode->Flow.BombTimeLeft < Need * (1.f - Mode->Bomb.DefuseProgress) + 1.5f;
}

void FTSBotBrain::Perceive(float Dt)
{
	if (Target != nullptr && !Target->IsAlive()) Target = nullptr;
	PerceiveTimer -= Dt;
	if (PerceiveTimer > 0.f) return;
	PerceiveTimer = Beh.PerceptionInterval;
	if (Self->BlindTimeLeft > 0.3f)
	{
		Target = nullptr;
		return;
	}
	const FVector Eye = Self->EyePosition();
	const FVector View = FRotator(Pitch, Yaw, 0.f).Vector();
	ATSCharacter* Best = nullptr;
	double BestDist = TNumericLimits<double>::Max();
	bool bCurrentVisible = false;
	for (ATSCharacter* Enemy : Mode->AliveCharacters())
	{
		if (Enemy->Team() == Self->Team()) continue;
		if (Enemy->RevealedUntil > Mode->MatchTime) Remember(Enemy->Feet());
		if (Mode->MatchTime - Enemy->LastNoiseTime < 0.6f && FVector::DistSquared(Enemy->LastNoisePosition, Self->Feet()) < FMath::Square(2500.0))
			Remember(Enemy->LastNoisePosition);
		const FVector To = Enemy->ChestPosition() - Eye;
		const double Dist = To.Size();
		if (Dist > Diff.SightRange * 100.f) continue;
		const float Angle = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp((float)FVector::DotProduct(View, To.GetSafeNormal()), -1.f, 1.f)));
		const bool bInCone = Angle < Diff.ViewAngle * 0.5f || Dist < 250.0 || Enemy == Target;
		if (!bInCone) continue;
		if (!Mode->Combat.LineOfSight(Eye, Enemy->HeadPosition()) && !Mode->Combat.LineOfSight(Eye, Enemy->ChestPosition())) continue;
		if (Enemy == Target) bCurrentVisible = true;
		if (Dist < BestDist)
		{
			BestDist = Dist;
			Best = Enemy;
		}
	}
	if (bCurrentVisible) Best = Target;
	if (Best == nullptr && Mode->MatchTime - Self->LastDamagedTime < 0.5f) Remember(Self->LastDamageFrom);
	if (Best != Target && Best != nullptr)
	{
		TargetAcquiredTime = Mode->MatchTime;
		bAimHead = Rng.Chance(Diff.HeadshotBias);
		AimError = RandomInCircle() * Diff.AimErrorDegrees;
		BurstFired = 0;
	}
	Target = Best;
	if (Target != nullptr) Remember(Target->Feet());
}

void FTSBotBrain::Remember(const FVector& P)
{
	LastKnownPos = P;
	LastKnownTime = Mode->MatchTime;
}

FVector2D FTSBotBrain::RandomInCircle()
{
	const float A = Rng.Range(0.f, 2.f * UE_PI);
	const float R = FMath::Sqrt(Rng.NextFloat());
	return FVector2D(FMath::Cos(A) * R, FMath::Sin(A) * R);
}

void FTSBotBrain::Decide()
{
	const FTSBombSystem& Bomb = Mode->Bomb;
	const FTSWorldMap& World = Mode->World;
	FTSTeamPlan& Plan = Mode->Plan;
	if (Self->Side() == ETSSide::Attack)
	{
		if (Bomb.State == ETSBombState::Planted)
		{
			if (Task != ETask::Guard || !bHasGoal)
			{
				Task = ETask::Guard;
				SetGoal(FTSTeamPlan::PickSpotNear(Mode, Bomb.Position, Beh.HoldRadiusCells));
			}
		}
		else if (Bomb.State == ETSBombState::Dropped && IsClosestTo(Bomb.Position, ETSSide::Attack))
		{
			Task = ETask::Fetch;
			SetGoal(World.WorldToCell(Bomb.Position));
		}
		else if (Self->bCarryingBomb)
		{
			Task = ETask::Plant;
			if (!bHasGoal || World.Grid.SiteIndexAt(Goal.X, Goal.Y) != Plan.AttackSite)
				SetGoal(RandomCell(Plan.AttackSite == 0 ? ETSCellType::SiteA : ETSCellType::SiteB), Plan.GoesViaMid(Self->Id()));
		}
		else
		{
			const bool bAtSite = World.SiteAt(Self->Feet()) == Plan.AttackSite;
			if (!bHasGoal || (bArrived && Mode->MatchTime - ArrivedTime > 6.f))
			{
				Task = ETask::Move;
				SetGoal(RandomCell(Plan.AttackSite == 0 ? ETSCellType::SiteA : ETSCellType::SiteB), !bAtSite && Plan.GoesViaMid(Self->Id()));
			}
			else if (bArrived)
			{
				Task = ETask::Hold;
			}
		}
	}
	else
	{
		if (Bomb.State == ETSBombState::Planted)
		{
			const bool bDefuser = IsClosestTo(Bomb.Position, ETSSide::Defense);
			const ETask Wanted = bDefuser ? ETask::Defuse : ETask::Guard;
			if (Task != Wanted || !bHasGoal)
			{
				Task = Wanted;
				SetGoal(bDefuser ? World.WorldToCell(Bomb.Position) : FTSTeamPlan::PickSpotNear(Mode, Bomb.Position, 3));
			}
		}
		else if (Mode->MatchTime - LastKnownTime < Beh.MemorySeconds && FVector::DistSquared(LastKnownPos, Self->Feet()) < FMath::Square(2000.0) && Rng.Chance(0.3f))
		{
			Task = ETask::Move;
			SetGoal(World.WorldToCell(LastKnownPos));
		}
		else
		{
			const FTSCell Spot = Plan.DefenderSpot(Mode, Self->Id());
			if (!bHasGoal || Goal != Spot) SetGoal(Spot);
			Task = bArrived ? ETask::Hold : ETask::Move;
			if (bArrived && LookTimer <= 0.f) HoldYaw = YawOf(World.Center() - Self->Feet());
		}
	}
}

bool FTSBotBrain::IsClosestTo(const FVector& Point, ETSSide Side) const
{
	const double Mine = FVector::DistSquared2D(Self->Feet(), Point);
	for (ATSCharacter* C : Mode->AliveCharacters())
	{
		if (C == Self || C->Side() != Side || !C->Record->bIsBot) continue;
		if (FVector::DistSquared2D(C->Feet(), Point) < Mine - 1.0) return false;
	}
	return true;
}

FTSCell FTSBotBrain::RandomCell(ETSCellType Type)
{
	const TArray<FTSCell> Cells = Mode->World.Cells(Type);
	return Cells.Num() > 0 ? Cells[Rng.RangeInt(0, Cells.Num())] : Mode->World.WorldToCell(Self->Feet());
}

void FTSBotBrain::SetGoal(const FTSCell& Cell, bool bThroughMid)
{
	const FTSNavGrid& Nav = Mode->World.Nav;
	Goal = Nav.NearestWalkable(Cell);
	bHasGoal = true;
	bHasVia = bThroughMid;
	if (bThroughMid) Via = Nav.NearestWalkable(Mode->World.WorldToCell(Mode->World.Center()));
	RebuildPath();
}

void FTSBotBrain::RebuildPath()
{
	FTSWorldMap& World = Mode->World;
	bArrived = false;
	Waypoints.Reset();
	Waypoint = 0;
	const FTSCell Start = World.Nav.NearestWalkable(World.WorldToCell(Self->Feet()));
	if (!World.Nav.FindPath(Start, bHasVia ? Via : Goal, CellPath)) return;
	const TArray<FTSCell> Smooth = World.Nav.Smooth(CellPath);
	const float Jitter = World.Grid.CellSize * 20.f;
	for (int32 i = 1; i < Smooth.Num(); ++i)
	{
		FVector P = World.CellToWorld(Smooth[i]);
		if (i < Smooth.Num() - 1) P += FVector(Rng.Range(-Jitter, Jitter), Rng.Range(-Jitter, Jitter), 0.f);
		Waypoints.Add(P);
	}
	ProgressPos = Self->Feet();
	ProgressTimer = 0.f;
}

FVector FTSBotBrain::FollowPath(float Dt)
{
	if (!bHasGoal) return FVector::ZeroVector;
	while (Waypoint < Waypoints.Num())
	{
		const FVector D(Waypoints[Waypoint].X - Self->Feet().X, Waypoints[Waypoint].Y - Self->Feet().Y, 0.f);
		if (D.Size() >= 60.f) break;
		++Waypoint;
	}
	if (Waypoint >= Waypoints.Num())
	{
		if (bHasVia)
		{
			bHasVia = false;
			RebuildPath();
			return FVector::ZeroVector;
		}
		if (!bArrived)
		{
			bArrived = true;
			ArrivedTime = Mode->MatchTime;
		}
		return FVector::ZeroVector;
	}
	const FVector D(Waypoints[Waypoint].X - Self->Feet().X, Waypoints[Waypoint].Y - Self->Feet().Y, 0.f);
	ProgressTimer += Dt;
	if (ProgressTimer > Beh.StuckSeconds)
	{
		if (FVector::Dist2D(Self->Feet(), ProgressPos) < 50.0)
		{
			UnstickTimer = 0.6f;
			UnstickDir = FRotator(0.f, Rng.Chance(0.5f) ? 90.f : -90.f, 0.f).RotateVector(D.GetSafeNormal());
			bJumpNext = true;
			RebuildPath();
		}
		ProgressPos = Self->Feet();
		ProgressTimer = 0.f;
	}
	if (UnstickTimer > 0.f)
	{
		UnstickTimer -= Dt;
		return (D.GetSafeNormal() + UnstickDir).GetSafeNormal();
	}
	return D.GetSafeNormal();
}

void FTSBotBrain::Aim(float Dt)
{
	const FVector Point = bAimHead ? Target->HeadPosition() : Target->ChestPosition();
	const FVector To = Point - Self->EyePosition();
	float DesiredYaw = YawOf(To);
	float DesiredPitch = PitchOf(To);
	AimErrorTimer -= Dt;
	if (AimErrorTimer <= 0.f)
	{
		AimErrorTimer = 0.25f;
		AimError = AimError * 0.6f + RandomInCircle() * (Diff.AimErrorDegrees * 0.4f);
	}
	const float Tracking = FMath::Clamp(1.f - (Mode->MatchTime - TargetAcquiredTime) / 1.5f, 0.f, 1.f) * 0.7f + 0.3f;
	const float Blind = Self->BlindTimeLeft > 0.f ? 4.f : 1.f;
	DesiredYaw += (float)AimError.X * Tracking * Blind - Self->RecoilYaw * Diff.RecoilControl;
	DesiredPitch += (float)AimError.Y * Tracking * Blind - Self->RecoilPitch * Diff.RecoilControl;
	Yaw = MoveTowardsAngle(Yaw, DesiredYaw, Diff.TurnSpeed * Dt);
	Pitch = FMath::FInterpConstantTo(Pitch, FMath::Clamp(DesiredPitch, -89.f, 89.f), Dt, Diff.TurnSpeed);
}

void FTSBotBrain::Fight(float Dt, FTSIntent& Intent, FVector& MoveDir)
{
	FTSWeaponHandler& W = Self->Weapons;
	const FTSWeaponDef* Def = W.CurrentDef();
	if (Def == nullptr) return;
	const FVector To = (bAimHead ? Target->HeadPosition() : Target->ChestPosition()) - Self->EyePosition();
	const float Dist = (float)(To.Size() / 100.0);
	const float Error = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp((float)FVector::DotProduct(Self->AimForward(), To.GetSafeNormal()), -1.f, 1.f)));
	const bool bReacting = Mode->MatchTime - TargetAcquiredTime < Diff.ReactionTime * (Self->BlindTimeLeft > 0.f ? 3.f : 1.f);
	const float Tolerance = FMath::Max(1.5f, W.CurrentSpread + 1.f) + (Dist < 5.f ? 6.f : 0.f);

	if (Def->GetMode() == ETSFireMode::Melee)
	{
		MoveDir = FVector(To.X, To.Y, 0.f).GetSafeNormal();
		Intent.bFire = Dist < Def->MaxRange + 0.5f && Error < 20.f;
		return;
	}
	if (Def->Scoped) Intent.bAim = true;
	bool bCanShoot = !bReacting && Error < Tolerance && W.Current().Mag > 0 && !W.IsReloading() && (!Def->Scoped || W.AimTime > 0.3f);

	if (Def->GetMode() == ETSFireMode::Auto)
	{
		if (W.ShotsFired != LastShotsFired) BurstFired += W.ShotsFired - LastShotsFired;
		if (BurstFired >= Diff.BurstShots)
		{
			BurstFired = 0;
			BurstPauseLeft = Diff.BurstPause;
		}
		if (BurstPauseLeft > 0.f)
		{
			BurstPauseLeft -= Dt;
			bCanShoot = false;
		}
		Intent.bFire = bCanShoot;
	}
	else if (bCanShoot && W.IsReady())
	{
		bFireToggle = !bFireToggle;
		Intent.bFire = bFireToggle;
	}
	LastShotsFired = W.ShotsFired;

	// Rifles and snipers stop to shoot accurately; SMGs and shotguns strafe.
	const ETSWeaponCategory Cat = Def->GetCategory();
	if (Cat == ETSWeaponCategory::Smg || Cat == ETSWeaponCategory::Shotgun)
	{
		StrafeTimer -= Dt;
		if (StrafeTimer <= 0.f)
		{
			Strafe = Rng.Chance(0.5f) ? 1.f : -1.f;
			StrafeTimer = Rng.Range(0.3f, 0.8f);
		}
		MoveDir = FRotationMatrix(FRotator(0.f, Yaw, 0.f)).GetUnitAxis(EAxis::Y) * Strafe;
		if (Cat == ETSWeaponCategory::Shotgun && Dist > 8.f) MoveDir += FVector(To.X, To.Y, 0.f).GetSafeNormal();
	}
	else
	{
		MoveDir = FVector::ZeroVector;
	}
}

void FTSBotBrain::Look(float Dt, const FVector& MoveDir)
{
	FVector Dir;
	if (Mode->MatchTime - LastKnownTime < Beh.MemorySeconds) Dir = LastKnownPos + FVector(0.f, 0.f, 140.f) - Self->EyePosition();
	else if (!MoveDir.IsNearlyZero()) Dir = MoveDir;
	else
	{
		LookTimer -= Dt;
		if (LookTimer <= 0.f)
		{
			LookTimer = Rng.Range(1.5f, 3.5f);
			HoldYaw += Rng.Range(-50.f, 50.f);
		}
		Dir = FRotator(0.f, HoldYaw, 0.f).Vector();
	}
	const float DesiredYaw = YawOf(Dir);
	const float DesiredPitch = MoveDir.IsNearlyZero() ? FMath::Clamp(PitchOf(Dir), -30.f, 30.f) : 0.f;
	Yaw = MoveTowardsAngle(Yaw, DesiredYaw, Diff.TurnSpeed * 0.6f * Dt);
	Pitch = FMath::FInterpConstantTo(Pitch, DesiredPitch, Dt, Diff.TurnSpeed * 0.6f);
	if (!MoveDir.IsNearlyZero()) HoldYaw = Yaw;
}

void FTSBotBrain::UseAbilities(float Dt, FTSIntent& Intent)
{
	AbilityTimer -= Dt;
	if (AbilityTimer > 0.f || Self->bFrozen) return;
	AbilityTimer = 0.5f;
	const FTSAbilityHandler& Ab = Self->Abilities;
	const float Chance = Diff.AbilityUseChance;
	int32 Slot;

	if (Target == nullptr && Self->Health < 60 && (Slot = Ab.FindReady(ETSAbilityType::Heal)) >= 0) { Intent.UseAbility = Slot; return; }
	if (Target != nullptr)
	{
		if ((Slot = Ab.FindReady(ETSAbilityType::Buff)) >= 0 && Rng.Chance(Chance)) { Intent.UseAbility = Slot; return; }
		const float Dist = (float)(FVector::Dist(Self->Feet(), Target->Feet()) / 100.0);
		if (Dist > 8.f && Mode->MatchTime - TargetAcquiredTime < 1.f && Rng.Chance(Chance * 0.5f))
		{
			for (ETSAbilityType Type : { ETSAbilityType::Frag, ETSAbilityType::Incendiary, ETSAbilityType::Flash })
			{
				if ((Slot = Ab.FindReady(Type)) < 0) continue;
				Pitch = FMath::Clamp(Pitch + 8.f, -89.f, 89.f);
				Intent.UseAbility = Slot;
				return;
			}
		}
		return;
	}
	const FVector AttackSite = Mode->World.SiteCenter(Mode->Plan.AttackSite);
	if ((Slot = Ab.FindReady(ETSAbilityType::Recon)) >= 0 && Rng.Chance(Chance * 0.3f) &&
		(Mode->Bomb.State == ETSBombState::Planted || FVector::Dist2D(Self->Feet(), AttackSite) < 2000.0))
	{
		Intent.UseAbility = Slot;
		return;
	}
	if (Self->Side() == ETSSide::Attack && Mode->Bomb.State != ETSBombState::Planted)
	{
		const float D = (float)(FVector::Dist2D(Self->Feet(), AttackSite) / 100.0);
		if (D < 22.f && D > 8.f)
		{
			if ((Slot = Ab.FindReady(ETSAbilityType::Smoke)) >= 0 && Rng.Chance(Chance))
			{
				Yaw = YawOf(AttackSite - Self->EyePosition());
				Pitch = 12.f;
				Intent.UseAbility = Slot;
				return;
			}
			if ((Slot = Ab.FindReady(ETSAbilityType::Dash)) >= 0 && Rng.Chance(Chance * 0.5f)) { Intent.UseAbility = Slot; return; }
		}
	}
	if (Self->Side() == ETSSide::Defense && Task == ETask::Hold && bArrived && (Slot = Ab.FindReady(ETSAbilityType::Wall)) >= 0 && Rng.Chance(Chance * 0.2f))
		Intent.UseAbility = Slot;
}

void FTSBotBrain::ManageWeapons(FTSIntent& Intent)
{
	FTSWeaponHandler& W = Self->Weapons;
	const FTSWeaponInstance& Primary = W.Slots[0];
	const FTSWeaponInstance& Secondary = W.Slots[1];
	const bool bPrimaryAmmo = Primary.IsValid() && (Primary.Mag > 0 || Primary.Reserve > 0);
	const bool bSecondaryAmmo = Secondary.IsValid() && (Secondary.Mag > 0 || Secondary.Reserve > 0);
	if (Target != nullptr && W.CurrentSlot == 0 && Primary.Mag == 0 && Secondary.IsValid() && Secondary.Mag > 0) Intent.SelectSlot = 1;
	else if (Target == nullptr && bPrimaryAmmo && W.CurrentSlot != 0) Intent.SelectSlot = 0;
	else if (W.CurrentSlot == 0 && !bPrimaryAmmo) Intent.SelectSlot = bSecondaryAmmo ? 1 : 2;
	else if (W.CurrentSlot == 1 && !bSecondaryAmmo) Intent.SelectSlot = bPrimaryAmmo ? 0 : 2;
	else if (W.CurrentSlot == 2 && (bPrimaryAmmo || bSecondaryAmmo)) Intent.SelectSlot = bPrimaryAmmo ? 0 : 1;
	const FTSWeaponInstance& Cur = W.Current();
	if (Target == nullptr && Cur.IsValid() && Cur.Def->MagazineSize > 0 && Cur.Mag < Cur.Def->MagazineSize * 0.4f && Cur.Reserve > 0) Intent.bReload = true;
}

void FTSBotBrain::ToMoveIntent(const FVector& Dir, FTSIntent& Intent) const
{
	if (Dir.IsNearlyZero(0.1)) return;
	const FRotationMatrix M(FRotator(0.f, Yaw, 0.f));
	Intent.MoveForward = FMath::Clamp((float)FVector::DotProduct(Dir, M.GetUnitAxis(EAxis::X)), -1.f, 1.f);
	Intent.MoveRight = FMath::Clamp((float)FVector::DotProduct(Dir, M.GetUnitAxis(EAxis::Y)), -1.f, 1.f);
}
