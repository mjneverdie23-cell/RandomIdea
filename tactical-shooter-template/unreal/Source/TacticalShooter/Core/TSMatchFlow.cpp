#include "TSMatchFlow.h"
#include "TSRules.h"

TArray<FTSFlowEvent> FTSMatchFlow::Start(ETSSide StartSideA)
{
	Score[0] = Score[1] = 0;
	LossStreak[0] = LossStreak[1] = 0;
	SideOfA = StartSideA;
	bInOvertime = false;
	OvertimeRoundsPlayed = 0;
	bPendingMatchEnd = bPendingSwap = bSwappedBeforeNextRound = bOvertimeAnnounced = false;
	bIsDraw = false;
	Round = 1;
	BeginRound(ETSEconomyReset::StartMoney);
	return Drain();
}

TArray<FTSFlowEvent> FTSMatchFlow::Tick(float Dt, const FTSRoundSnapshot& Snap)
{
	switch (Phase)
	{
	case ETSMatchPhase::BuyPhase:
		PhaseTimeLeft -= Dt;
		if (PhaseTimeLeft <= 0.f)
		{
			PhaseTimeLeft = 0.f;
			SetPhase(ETSMatchPhase::Live);
		}
		break;

	case ETSMatchPhase::Live:
	{
		LiveElapsed += Dt;
		if (bBombPlanted)
		{
			if (!bBombDefused && !bBombDetonated)
			{
				BombTimeLeft -= Dt;
				if (BombTimeLeft <= 0.f)
				{
					BombTimeLeft = 0.f;
					bBombDetonated = true;
					FTSFlowEvent E;
					E.Type = ETSFlowEventType::BombDetonated;
					E.Round = Round;
					E.Site = BombSite;
					Emit(E);
				}
			}
		}
		else
		{
			RoundTimeLeft = FMath::Max(0.f, RoundTimeLeft - Dt);
		}
		ETSSide WinnerSide;
		ETSRoundEndReason Reason;
		if (EvaluateRoundEnd(bBombDetonated, bBombDefused, bBombPlanted, Snap.AliveAttackers, Snap.AliveDefenders, RoundTimeLeft, WinnerSide, Reason))
			EndRound(TeamOn(WinnerSide), Reason);
		break;
	}

	case ETSMatchPhase::RoundEnd:
		PhaseTimeLeft -= Dt;
		if (PhaseTimeLeft <= 0.f) FinishRoundEnd();
		break;

	case ETSMatchPhase::Halftime:
		PhaseTimeLeft -= Dt;
		if (PhaseTimeLeft <= 0.f) NextRound();
		break;

	default:
		break;
	}
	return Drain();
}

void FTSMatchFlow::NotifyBombPlanted(int32 Site)
{
	if (Phase != ETSMatchPhase::Live || bBombPlanted) return;
	bBombPlanted = true;
	BombSite = Site;
	BombTimeLeft = B.FuseSeconds;
	FTSFlowEvent E;
	E.Type = ETSFlowEventType::BombPlanted;
	E.Round = Round;
	E.Site = Site;
	Emit(E);
}

void FTSMatchFlow::NotifyBombDefused()
{
	if (Phase != ETSMatchPhase::Live || !bBombPlanted || bBombDetonated || bBombDefused) return;
	bBombDefused = true;
	FTSFlowEvent E;
	E.Type = ETSFlowEventType::BombDefused;
	E.Round = Round;
	E.Site = BombSite;
	Emit(E);
}

bool FTSMatchFlow::EvaluateRoundEnd(bool bDetonated, bool bDefused, bool bPlanted, int32 AliveAttackers, int32 AliveDefenders,
	float RoundTimeLeft, ETSSide& OutWinner, ETSRoundEndReason& OutReason)
{
	OutWinner = ETSSide::Defense;
	OutReason = ETSRoundEndReason::None;
	if (bDetonated) { OutWinner = ETSSide::Attack; OutReason = ETSRoundEndReason::BombDetonated; return true; }
	if (bDefused) { OutWinner = ETSSide::Defense; OutReason = ETSRoundEndReason::BombDefused; return true; }
	if (!bPlanted && AliveAttackers == 0) { OutWinner = ETSSide::Defense; OutReason = ETSRoundEndReason::Elimination; return true; }
	if (AliveDefenders == 0) { OutWinner = ETSSide::Attack; OutReason = ETSRoundEndReason::Elimination; return true; }
	if (!bPlanted && RoundTimeLeft <= 0.f) { OutWinner = ETSSide::Defense; OutReason = ETSRoundEndReason::TimeExpired; return true; }
	return false;
}

void FTSMatchFlow::BeginRound(ETSEconomyReset Reset)
{
	bBombPlanted = bBombDefused = bBombDetonated = false;
	BombSite = -1;
	RoundTimeLeft = R.RoundSeconds;
	BombTimeLeft = 0.f;
	LiveElapsed = 0.f;
	PhaseTimeLeft = R.BuyPhaseSeconds + (Round == 1 ? M.FirstRoundExtraBuySeconds : 0.f);
	if (bInOvertime && !bOvertimeAnnounced)
	{
		bOvertimeAnnounced = true;
		FTSFlowEvent E;
		E.Type = ETSFlowEventType::OvertimeStarted;
		E.Round = Round;
		Emit(E);
	}
	FTSFlowEvent E;
	E.Type = ETSFlowEventType::RoundStarted;
	E.Round = Round;
	E.Reset = Reset;
	Emit(E);
	SetPhase(ETSMatchPhase::BuyPhase);
}

void FTSMatchFlow::EndRound(ETSTeam WinnerTeam, ETSRoundEndReason Reason)
{
	const ETSTeam Loser = TSIds::Other(WinnerTeam);
	const ETSSide WinnerSide = SideOf(WinnerTeam);
	LastWinner = WinnerTeam;
	LastReason = Reason;
	const int32 W = TSIds::Index(WinnerTeam), L = TSIds::Index(Loser);
	Score[W]++;
	LossStreak[W] = TSEconomy::NextLossStreak(LossStreak[W], true);
	LossStreak[L] = TSEconomy::NextLossStreak(LossStreak[L], false);

	const int32 Played = Round;
	bPendingSwap = false;
	bPendingMatchEnd = false;
	if (!bInOvertime)
	{
		if (Score[0] >= M.RoundsToWin || Score[1] >= M.RoundsToWin)
			DecideWinner(Score[0] >= M.RoundsToWin ? ETSTeam::A : ETSTeam::B);
		else if (M.OvertimeEnabled && Score[0] == M.RoundsToWin - 1 && Score[1] == M.RoundsToWin - 1)
			bInOvertime = true;
		else if (Played >= RegulationRounds())
			DecideByScore();
		else if (Played == M.HalftimeAfterRound)
			bPendingSwap = true;
	}
	else
	{
		OvertimeRoundsPlayed++;
		const int32 Lead = FMath::Abs(Score[0] - Score[1]);
		if (Lead >= M.OvertimeWinMargin)
			DecideWinner(Score[0] > Score[1] ? ETSTeam::A : ETSTeam::B);
		else if (OvertimeRoundsPlayed >= M.MaxOvertimeRounds)
			DecideByScore();
		else if (OvertimeRoundsPlayed % FMath::Max(1, M.OvertimeSwapEveryRounds) == 0)
			bPendingSwap = true;
	}

	FTSFlowEvent E;
	E.Type = ETSFlowEventType::RoundEnded;
	E.Team = WinnerTeam;
	E.Side = WinnerSide;
	E.Reason = Reason;
	E.Round = Played;
	E.bBombPlanted = bBombPlanted;
	Emit(E);
	PhaseTimeLeft = R.RoundEndSeconds;
	SetPhase(ETSMatchPhase::RoundEnd);
}

void FTSMatchFlow::DecideWinner(ETSTeam T)
{
	bPendingMatchEnd = true;
	Winner = T;
	bIsDraw = false;
}

void FTSMatchFlow::DecideByScore()
{
	bPendingMatchEnd = true;
	bIsDraw = Score[0] == Score[1];
	Winner = Score[0] >= Score[1] ? ETSTeam::A : ETSTeam::B;
}

void FTSMatchFlow::FinishRoundEnd()
{
	if (bPendingMatchEnd)
	{
		SetPhase(ETSMatchPhase::MatchOver);
		FTSFlowEvent E;
		E.Type = ETSFlowEventType::MatchEnded;
		E.Team = Winner;
		E.bDraw = bIsDraw;
		E.Round = Round;
		Emit(E);
		return;
	}
	if (bPendingSwap)
	{
		bPendingSwap = false;
		bSwappedBeforeNextRound = true;
		SideOfA = TSIds::Other(SideOfA);
		FTSFlowEvent E;
		E.Type = ETSFlowEventType::SidesSwapped;
		E.Round = Round;
		E.Side = SideOfA;
		Emit(E);
		if (!bInOvertime && M.HalftimeSeconds > 0.f)
		{
			PhaseTimeLeft = M.HalftimeSeconds;
			SetPhase(ETSMatchPhase::Halftime);
			return;
		}
	}
	NextRound();
}

void FTSMatchFlow::NextRound()
{
	Round++;
	ETSEconomyReset Reset;
	if (bInOvertime) Reset = bSwappedBeforeNextRound ? ETSEconomyReset::OvertimeMoneyAndClear : ETSEconomyReset::OvertimeMoney;
	else Reset = bSwappedBeforeNextRound ? ETSEconomyReset::StartMoney : ETSEconomyReset::None;
	if (Reset != ETSEconomyReset::None) LossStreak[0] = LossStreak[1] = 0;
	bSwappedBeforeNextRound = false;
	BeginRound(Reset);
}

void FTSMatchFlow::SetPhase(ETSMatchPhase P)
{
	Phase = P;
	FTSFlowEvent E;
	E.Type = ETSFlowEventType::PhaseChanged;
	E.Phase = P;
	E.Round = Round;
	Emit(E);
}

TArray<FTSFlowEvent> FTSMatchFlow::Drain()
{
	TArray<FTSFlowEvent> Out = MoveTemp(Pending);
	Pending.Reset();
	return Out;
}
