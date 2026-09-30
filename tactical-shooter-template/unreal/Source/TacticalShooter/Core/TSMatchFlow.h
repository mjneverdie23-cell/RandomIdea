#pragma once

#include "CoreMinimal.h"
#include "TSEnums.h"
#include "TSConfigTypes.h"

/** Alive counts the engine reports every tick. */
struct FTSRoundSnapshot
{
	int32 AliveAttackers = 0;
	int32 AliveDefenders = 0;
};

enum class ETSFlowEventType : uint8
{
	RoundStarted,    // Round, Reset
	PhaseChanged,    // Phase
	OvertimeStarted, // Round
	BombPlanted,     // Site
	BombDefused,
	BombDetonated,
	RoundEnded,      // Team, Side, Reason, Round, bBombPlanted
	SidesSwapped,
	MatchEnded,      // Team, bDraw
};

struct FTSFlowEvent
{
	ETSFlowEventType Type = ETSFlowEventType::PhaseChanged;
	ETSMatchPhase Phase = ETSMatchPhase::NotStarted;
	ETSTeam Team = ETSTeam::A;
	ETSSide Side = ETSSide::Attack;
	ETSRoundEndReason Reason = ETSRoundEndReason::None;
	int32 Round = 0;
	int32 Site = -1;
	bool bBombPlanted = false;
	bool bDraw = false;
	ETSEconomyReset Reset = ETSEconomyReset::None;
};

/**
 * Phases, timers, scores, sides, halftime and overtime (GAME_RULES.md section 2). Pure logic:
 * ATSGameMode calls Tick every frame with the alive counts and reacts to the returned events.
 * Mirrors MatchFlow.cs in the Unity project; both replay shared/tests/rules_vectors.json.
 */
class TACTICALSHOOTER_API FTSMatchFlow
{
public:
	FTSMatchFlow() {}
	FTSMatchFlow(const FTSMatchSettings& InMatch, const FTSRoundSettings& InRound, const FTSBombSettings& InBomb)
		: M(InMatch), R(InRound), B(InBomb) {}

	TArray<FTSFlowEvent> Start(ETSSide StartSideA);
	TArray<FTSFlowEvent> Tick(float Dt, const FTSRoundSnapshot& Snap);

	/** Called by the bomb system when a plant completes. Site: 0 = A, 1 = B. */
	void NotifyBombPlanted(int32 Site);
	/** Called when a defuse completes. The round ends on the next Tick. */
	void NotifyBombDefused();

	/** GAME_RULES.md 2.1. Returns true when the round is over. */
	static bool EvaluateRoundEnd(bool bDetonated, bool bDefused, bool bPlanted, int32 AliveAttackers, int32 AliveDefenders,
		float InRoundTimeLeft, ETSSide& OutWinner, ETSRoundEndReason& OutReason);

	ETSSide SideOf(ETSTeam T) const { return T == ETSTeam::A ? SideOfA : TSIds::Other(SideOfA); }
	ETSTeam TeamOn(ETSSide S) const { return SideOfA == S ? ETSTeam::A : ETSTeam::B; }
	bool IsMatchOver() const { return Phase == ETSMatchPhase::MatchOver; }
	bool MovementFrozen() const { return Phase == ETSMatchPhase::BuyPhase && R.FreezeDuringBuyPhase; }
	bool CanSell() const { return Phase == ETSMatchPhase::BuyPhase; }
	bool CanBuy() const { return Phase == ETSMatchPhase::BuyPhase || (Phase == ETSMatchPhase::Live && !bBombPlanted && LiveElapsed <= R.BuyGraceSeconds); }
	int32 RegulationRounds() const { return 2 * M.HalftimeAfterRound; }
	/** Seconds shown on the HUD clock for the current phase. */
	float ClockSeconds() const { return Phase == ETSMatchPhase::Live ? (bBombPlanted ? BombTimeLeft : RoundTimeLeft) : PhaseTimeLeft; }
	const FTSMatchSettings& Settings() const { return M; }

	ETSMatchPhase Phase = ETSMatchPhase::NotStarted;
	float PhaseTimeLeft = 0.f;
	float RoundTimeLeft = 0.f;
	float BombTimeLeft = 0.f;
	float LiveElapsed = 0.f;
	int32 Round = 0;
	int32 Score[2] = { 0, 0 };
	int32 LossStreak[2] = { 0, 0 };
	ETSSide SideOfA = ETSSide::Attack;
	bool bInOvertime = false;
	int32 OvertimeRoundsPlayed = 0;
	bool bBombPlanted = false;
	bool bBombDefused = false;
	bool bBombDetonated = false;
	int32 BombSite = -1;
	ETSTeam LastWinner = ETSTeam::A;
	ETSRoundEndReason LastReason = ETSRoundEndReason::None;
	ETSTeam Winner = ETSTeam::A;
	bool bIsDraw = false;

private:
	void BeginRound(ETSEconomyReset Reset);
	void EndRound(ETSTeam WinnerTeam, ETSRoundEndReason Reason);
	void DecideWinner(ETSTeam T);
	void DecideByScore();
	void FinishRoundEnd();
	void NextRound();
	void SetPhase(ETSMatchPhase P);
	void Emit(const FTSFlowEvent& E) { Pending.Add(E); }
	TArray<FTSFlowEvent> Drain();

	FTSMatchSettings M;
	FTSRoundSettings R;
	FTSBombSettings B;
	TArray<FTSFlowEvent> Pending;
	bool bPendingMatchEnd = false;
	bool bPendingSwap = false;
	bool bSwappedBeforeNextRound = false;
	bool bOvertimeAnnounced = false;
};
