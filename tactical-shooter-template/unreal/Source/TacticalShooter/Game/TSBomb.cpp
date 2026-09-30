#include "Game/TSBomb.h"
#include "Game/TSCharacter.h"
#include "Game/TSEffects.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"
#include "Engine/World.h"

namespace
{
	const FTSGameConfig& BombGameConfig(const ATSGameMode* Mode) { return UTSGameSubsystem::Get(Mode)->Data().Game; }
}

void FTSBombSystem::Init(ATSGameMode* InMode)
{
	Mode = InMode;
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	UWorld* World = Mode->GetWorld();
	if (ATSShapeActor* Bomb = World->SpawnActor<ATSShapeActor>(FVector::ZeroVector, FRotator::ZeroRotator, Params))
	{
		Bomb->Setup(ETSShape::Cube, UTSGameSubsystem::Color(BombGameConfig(Mode).Visuals.BombColor), FVector(0.32f, 0.45f, 0.22f));
		Bomb->SetActorHiddenInGame(true);
		BombActor = Bomb;
	}
	if (ATSShapeActor* Light = World->SpawnActor<ATSShapeActor>(FVector::ZeroVector, FRotator::ZeroRotator, Params))
	{
		Light->Setup(ETSShape::Sphere, FLinearColor::White, FVector(0.12f));
		Light->SetActorHiddenInGame(true);
		LightActor = Light;
	}
}

void FTSBombSystem::Destroy()
{
	if (BombActor.IsValid()) BombActor->Destroy();
	if (LightActor.IsValid()) LightActor->Destroy();
}

void FTSBombSystem::Reset()
{
	if (Carrier != nullptr) Carrier->SetCarryingBomb(false);
	State = ETSBombState::None;
	Carrier = Planter = Defuser = DroppedBy = nullptr;
	PlantProgress = DefuseProgress = 0.f;
	Site = -1;
	if (BombActor.IsValid()) BombActor->SetActorHiddenInGame(true);
	if (LightActor.IsValid()) LightActor->SetActorHiddenInGame(true);
}

void FTSBombSystem::GiveTo(ATSCharacter* C)
{
	State = ETSBombState::Carried;
	Carrier = C;
	DroppedBy = nullptr;
	C->SetCarryingBomb(true);
	if (BombActor.IsValid()) BombActor->SetActorHiddenInGame(true);
	if (LightActor.IsValid()) LightActor->SetActorHiddenInGame(true);
}

void FTSBombSystem::Drop(const FVector& At, ATSCharacter* By)
{
	if (State != ETSBombState::Carried) return;
	if (Carrier != nullptr) Carrier->SetCarryingBomb(false);
	Carrier = nullptr;
	DroppedBy = By;
	Planter = nullptr;
	PlantProgress = 0.f;
	State = ETSBombState::Dropped;
	Position = FVector(At.X, At.Y, 0.f);
	Show(Position);
}

void FTSBombSystem::Tick(float Dt)
{
	const bool bLive = Mode->Flow.Phase == ETSMatchPhase::Live;
	const FTSBombSettings& S = BombGameConfig(Mode).Bomb;
	switch (State)
	{
	case ETSBombState::Carried:
	{
		ATSCharacter* C = Carrier;
		if (C == nullptr || !C->IsAlive())
		{
			Drop(C != nullptr ? C->Feet() : Position);
			break;
		}
		if (C->LastIntent.bDrop)
		{
			Drop(Mode->DropPoint(C, S.PickupRadius * 100.f), C);
			break;
		}
		const int32 AtSite = Mode->World.SiteAt(C->Feet());
		const bool bPlanting = bLive && AtSite >= 0 && C->LastIntent.bInteract && C->IsGrounded();
		if (!bPlanting)
		{
			PlantProgress = 0.f;
			Planter = nullptr;
			break;
		}
		if (PlantProgress <= 0.f) Mode->PlaySound(TEXT("bomb_plant"), C->Feet());
		Planter = C;
		PlantProgress += Dt / FMath::Max(0.1f, S.PlantSeconds);
		if (PlantProgress >= 1.f) Plant(C, AtSite);
		break;
	}
	case ETSBombState::Dropped:
		if (!bLive && Mode->Flow.Phase != ETSMatchPhase::BuyPhase) break;
		for (ATSCharacter* C : Mode->AliveCharacters())
		{
			if (C->Side() != ETSSide::Attack) continue;
			const bool bInReach = FVector::DistSquared2D(C->Feet(), Position) <= FMath::Square(S.PickupRadius * 100.f);
			if (C == DroppedBy)
			{
				// The dropper has to leave the pickup radius first, or the bomb would bounce
				// straight back to them (it lands right at the edge of the radius).
				if (!bInReach) DroppedBy = nullptr;
				continue;
			}
			if (bInReach)
			{
				GiveTo(C);
				break;
			}
		}
		break;
	case ETSBombState::Planted:
		Beep(Dt);
		if (bLive) Defuse(Dt);
		break;
	default:
		break;
	}
}

void FTSBombSystem::Plant(ATSCharacter* C, int32 InSite)
{
	const FTSGameConfig& G = BombGameConfig(Mode);
	State = ETSBombState::Planted;
	Site = InSite;
	Position = FVector(C->Feet().X, C->Feet().Y, 0.f);
	C->SetCarryingBomb(false);
	Carrier = nullptr;
	Planter = nullptr;
	PlantProgress = 0.f;
	BeepTimer = 0.f;
	Show(Position);
	FTSPlayerRecord* R = C->Record;
	R->Plants++;
	R->Score += G.Scoring.Plant;
	R->Money = TSEconomy::AddMoney(G.Economy, R->Money, G.Economy.PlantRewardPlayer);
	R->AddUltPoints(C->Agent, G.Ultimate.PointsPerPlant);
	Mode->Flow.NotifyBombPlanted(InSite);
}

void FTSBombSystem::Defuse(float Dt)
{
	const FTSGameConfig& G = BombGameConfig(Mode);
	const FTSBombSettings& S = G.Bomb;
	ATSCharacter* Best = nullptr;
	double BestDist = FMath::Square((double)S.InteractRadius * 100.0);
	for (ATSCharacter* C : Mode->AliveCharacters())
	{
		if (C->Side() != ETSSide::Defense || !C->LastIntent.bInteract || !C->IsGrounded()) continue;
		const double D = FVector::DistSquared2D(C->Feet(), Position);
		if (D <= BestDist)
		{
			BestDist = D;
			Best = C;
		}
	}
	if (Best == nullptr || (Defuser != nullptr && Best != Defuser))
	{
		if (DefuseProgress > 0.f) DefuseProgress = S.HalfDefuseCheckpoint && DefuseProgress >= 0.5f ? 0.5f : 0.f;
		Defuser = nullptr;
		if (Best == nullptr) return;
	}
	if (Defuser == nullptr) Mode->PlaySound(TEXT("bomb_plant"), Position, 0.6f);
	Defuser = Best;
	const float Seconds = Best->Record->Loadout.bHasDefuseKit ? S.DefuseKitSeconds : S.DefuseSeconds;
	DefuseProgress += Dt / FMath::Max(0.1f, Seconds);
	if (DefuseProgress < 1.f) return;

	FTSPlayerRecord* R = Best->Record;
	R->Defuses++;
	R->Score += G.Scoring.Defuse;
	R->Money = TSEconomy::AddMoney(G.Economy, R->Money, G.Economy.DefuseRewardPlayer);
	R->AddUltPoints(Best->Agent, G.Ultimate.PointsPerDefuse);
	State = ETSBombState::Defused;
	DefuseProgress = 1.f;
	Defuser = nullptr;
	if (LightActor.IsValid()) LightActor->SetActorHiddenInGame(true);
	Mode->Flow.NotifyBombDefused();
}

void FTSBombSystem::Beep(float Dt)
{
	const FTSBombSettings& S = BombGameConfig(Mode).Bomb;
	BeepTimer -= Dt;
	if (BeepTimer > 0.f) return;
	const float Frac = FMath::Clamp(Mode->Flow.BombTimeLeft / FMath::Max(1.f, S.FuseSeconds), 0.f, 1.f);
	BeepTimer = FMath::Lerp(S.BeepIntervalEnd, S.BeepIntervalStart, Frac);
	bLightOn = !bLightOn;
	if (LightActor.IsValid()) LightActor->SetActorHiddenInGame(!bLightOn);
	Mode->PlaySound(TEXT("bomb_beep"), Position);
}

void FTSBombSystem::Explode()
{
	const FTSBombSettings& S = BombGameConfig(Mode).Bomb;
	State = ETSBombState::Exploded;
	if (BombActor.IsValid()) BombActor->SetActorHiddenInGame(true);
	if (LightActor.IsValid()) LightActor->SetActorHiddenInGame(true);
	const FVector Center = Position + FVector(0.f, 0.f, 100.f);
	Mode->Effects.Burst(Center, S.BlastRadius, FLinearColor(1.f, 0.5f, 0.1f), 0.8f);
	Mode->PlaySound(TEXT("explosion"), Position);
	Mode->Combat.Explosion(Center, S.BlastRadius, (float)S.BlastDamage, 1.f, nullptr, TEXT("bomb"), false);
}

void FTSBombSystem::Show(const FVector& At)
{
	if (BombActor.IsValid())
	{
		BombActor->SetActorLocation(At + FVector(0.f, 0.f, 11.f));
		BombActor->SetActorHiddenInGame(false);
	}
	if (LightActor.IsValid())
	{
		LightActor->SetActorLocation(At + FVector(0.f, 0.f, 30.f));
		LightActor->SetActorHiddenInGame(false);
	}
}
