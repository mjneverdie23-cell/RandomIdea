#pragma once

#include "CoreMinimal.h"
#include "Core/TSConfigTypes.h"
#include "Core/TSIntent.h"
#include "Core/TSMapGrid.h"
#include "Core/TSRng.h"

class ATSGameMode;
class ATSCharacter;

/** Per-round team decisions for bots: which site attackers hit, where each defender holds. */
struct FTSTeamPlan
{
	int32 AttackSite = 0;
	int32 BombSite = -1;
	TMap<int32, FTSCell> DefenderSpots;
	TSet<int32> ViaMid;

	void OnRoundStart(ATSGameMode* Mode);
	void OnBombPlanted(int32 Site) { BombSite = Site; }
	bool GoesViaMid(int32 Id) const { return ViaMid.Contains(Id); }
	FTSCell DefenderSpot(ATSGameMode* Mode, int32 Id);
	/** A random walkable cell within Radius cells of a point that can see the point. */
	static FTSCell PickSpotNear(ATSGameMode* Mode, const FVector& Point, int32 Radius);
};

/**
 * Bot AI: perceive (sight cone, line of sight, smoke, hearing, recon) -> decide a task (hold,
 * move, plant, defuse, fetch the bomb, guard) -> path on the FTSNavGrid -> aim and shoot with
 * reaction time, aim error and recoil control. Produces the same FTSIntent a player does.
 * Tuning: shared/config/bots.json. Mirrors BotBrain.cs.
 */
class FTSBotBrain
{
public:
	FTSBotBrain() {}
	FTSBotBrain(ATSGameMode* InMode, ATSCharacter* InSelf, const FTSBotDifficulty& InDiff);

	void OnSpawn();
	FTSIntent Think(float Dt);
	FString DebugTask() const;

private:
	enum class ETask : uint8 { Hold, Move, Plant, Defuse, Fetch, Guard };

	bool MustDefuseNow() const;
	void Perceive(float Dt);
	void Remember(const FVector& P);
	FVector2D RandomInCircle();
	void Decide();
	bool IsClosestTo(const FVector& Point, ETSSide Side) const;
	FTSCell RandomCell(ETSCellType Type);
	void SetGoal(const FTSCell& Cell, bool bThroughMid = false);
	void RebuildPath();
	FVector FollowPath(float Dt);
	void Aim(float Dt);
	void Fight(float Dt, FTSIntent& Intent, FVector& MoveDir);
	void Look(float Dt, const FVector& MoveDir);
	void UseAbilities(float Dt, FTSIntent& Intent);
	void ManageWeapons(FTSIntent& Intent);
	void ToMoveIntent(const FVector& Dir, FTSIntent& Intent) const;

	ATSGameMode* Mode = nullptr;
	ATSCharacter* Self = nullptr;
	FTSBotDifficulty Diff;
	FTSBotBehaviourSettings Beh;
	FTSRng Rng;

	float Yaw = 0.f;
	float Pitch = 0.f;
	ETask Task = ETask::Move;
	float DecisionTimer = 0.f;

	float PerceiveTimer = 0.f;
	ATSCharacter* Target = nullptr;
	float TargetAcquiredTime = 0.f;
	bool bAimHead = false;
	FVector2D AimError = FVector2D::ZeroVector;
	float AimErrorTimer = 0.f;
	FVector LastKnownPos = FVector::ZeroVector;
	float LastKnownTime = -99.f;

	TArray<FTSCell> CellPath;
	TArray<FVector> Waypoints;
	int32 Waypoint = 0;
	FTSCell Goal;
	bool bHasGoal = false;
	bool bHasVia = false;
	FTSCell Via;
	bool bArrived = false;
	float ArrivedTime = 0.f;
	FVector ProgressPos = FVector::ZeroVector;
	float ProgressTimer = 0.f;
	float UnstickTimer = 0.f;
	FVector UnstickDir = FVector::ZeroVector;
	bool bJumpNext = false;

	int32 BurstFired = 0;
	int32 LastShotsFired = 0;
	float BurstPauseLeft = 0.f;
	bool bFireToggle = false;
	float Strafe = 1.f;
	float StrafeTimer = 0.f;
	float AbilityTimer = 0.f;
	float HoldYaw = 0.f;
	float LookTimer = 0.f;
};
