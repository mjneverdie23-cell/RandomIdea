using System.Collections.Generic;

namespace TacticalShooter.Core
{
    /// <summary>Alive counts the engine reports every tick.</summary>
    public struct RoundSnapshot
    {
        public int aliveAttackers;
        public int aliveDefenders;
    }

    public enum FlowEventType
    {
        RoundStarted,    // round, reset
        PhaseChanged,    // phase
        OvertimeStarted, // round
        BombPlanted,     // site
        BombDefused,
        BombDetonated,
        RoundEnded,      // team, side, reason, round, bombPlanted
        SidesSwapped,
        MatchEnded,      // team, draw
    }

    public struct FlowEvent
    {
        public FlowEventType type;
        public MatchPhase phase;
        public TeamId team;
        public Side side;
        public RoundEndReason reason;
        public int round;
        public int site;
        public bool bombPlanted;
        public bool draw;
        public EconomyReset reset;

        public override string ToString() => $"{type} round={round} phase={phase} team={team} side={side} reason={reason} reset={reset}";
    }

    /// <summary>
    /// Phases, timers, scores, sides, halftime and overtime (GAME_RULES.md section 2). Pure logic:
    /// the engine calls Tick every frame with the alive counts and reacts to the returned events
    /// (spawning, economy, UI). Mirrored by FTSMatchFlow in the Unreal project.
    /// </summary>
    public sealed class MatchFlow
    {
        readonly MatchSettings m;
        readonly RoundSettings r;
        readonly BombSettings b;
        readonly List<FlowEvent> pending = new List<FlowEvent>();

        public MatchPhase Phase { get; private set; } = MatchPhase.NotStarted;
        public float PhaseTimeLeft { get; private set; }
        public float RoundTimeLeft { get; private set; }
        public float BombTimeLeft { get; private set; }
        public float LiveElapsed { get; private set; }
        public int Round { get; private set; }
        public readonly int[] Score = new int[2];
        public readonly int[] LossStreak = new int[2];
        public Side SideOfA { get; private set; } = Side.Attack;
        public bool InOvertime { get; private set; }
        public int OvertimeRoundsPlayed { get; private set; }
        public bool BombPlanted { get; private set; }
        public bool BombDefused { get; private set; }
        public bool BombDetonated { get; private set; }
        public int BombSite { get; private set; } = -1;
        public TeamId LastWinner { get; private set; }
        public RoundEndReason LastReason { get; private set; }
        public TeamId Winner { get; private set; }
        public bool IsDraw { get; private set; }

        bool pendingMatchEnd;
        bool pendingSwap;
        bool swappedBeforeNextRound;
        bool overtimeAnnounced;

        public MatchFlow(MatchSettings match, RoundSettings round, BombSettings bomb)
        {
            m = match;
            r = round;
            b = bomb;
        }

        public Side SideOf(TeamId t) => t == TeamId.A ? SideOfA : Ids.Other(SideOfA);
        public TeamId TeamOn(Side s) => SideOfA == s ? TeamId.A : TeamId.B;
        public bool IsMatchOver => Phase == MatchPhase.MatchOver;
        public bool MovementFrozen => Phase == MatchPhase.BuyPhase && r.freezeDuringBuyPhase;
        public bool CanSell => Phase == MatchPhase.BuyPhase;
        public bool CanBuy => Phase == MatchPhase.BuyPhase ||
                              (Phase == MatchPhase.Live && !BombPlanted && LiveElapsed <= r.buyGraceSeconds);
        public int RegulationRounds => 2 * m.halftimeAfterRound;

        /// <summary>Seconds shown on the HUD clock for the current phase.</summary>
        public float ClockSeconds => Phase == MatchPhase.Live ? (BombPlanted ? BombTimeLeft : RoundTimeLeft) : PhaseTimeLeft;

        public List<FlowEvent> Start(Side startSideA)
        {
            Score[0] = Score[1] = 0;
            LossStreak[0] = LossStreak[1] = 0;
            SideOfA = startSideA;
            InOvertime = false;
            OvertimeRoundsPlayed = 0;
            pendingMatchEnd = pendingSwap = swappedBeforeNextRound = overtimeAnnounced = false;
            IsDraw = false;
            Round = 1;
            BeginRound(EconomyReset.StartMoney);
            return Drain();
        }

        public List<FlowEvent> Tick(float dt, RoundSnapshot snap)
        {
            switch (Phase)
            {
                case MatchPhase.BuyPhase:
                    PhaseTimeLeft -= dt;
                    if (PhaseTimeLeft <= 0f)
                    {
                        PhaseTimeLeft = 0f;
                        SetPhase(MatchPhase.Live);
                    }
                    break;

                case MatchPhase.Live:
                    LiveElapsed += dt;
                    if (BombPlanted)
                    {
                        if (!BombDefused && !BombDetonated)
                        {
                            BombTimeLeft -= dt;
                            if (BombTimeLeft <= 0f)
                            {
                                BombTimeLeft = 0f;
                                BombDetonated = true;
                                Emit(new FlowEvent { type = FlowEventType.BombDetonated, round = Round, site = BombSite });
                            }
                        }
                    }
                    else
                    {
                        RoundTimeLeft -= dt;
                        if (RoundTimeLeft < 0f) RoundTimeLeft = 0f;
                    }
                    if (EvaluateRoundEnd(BombDetonated, BombDefused, BombPlanted, snap.aliveAttackers, snap.aliveDefenders,
                            RoundTimeLeft, out Side winnerSide, out RoundEndReason reason))
                        EndRound(TeamOn(winnerSide), reason);
                    break;

                case MatchPhase.RoundEnd:
                    PhaseTimeLeft -= dt;
                    if (PhaseTimeLeft <= 0f) FinishRoundEnd();
                    break;

                case MatchPhase.Halftime:
                    PhaseTimeLeft -= dt;
                    if (PhaseTimeLeft <= 0f) NextRound();
                    break;
            }
            return Drain();
        }

        /// <summary>Called by the bomb system when a plant completes. site: 0 = A, 1 = B.</summary>
        public void NotifyBombPlanted(int site)
        {
            if (Phase != MatchPhase.Live || BombPlanted) return;
            BombPlanted = true;
            BombSite = site;
            BombTimeLeft = b.fuseSeconds;
            Emit(new FlowEvent { type = FlowEventType.BombPlanted, round = Round, site = site });
        }

        /// <summary>Called by the bomb system when a defuse completes. The round ends on the next Tick.</summary>
        public void NotifyBombDefused()
        {
            if (Phase != MatchPhase.Live || !BombPlanted || BombDetonated || BombDefused) return;
            BombDefused = true;
            Emit(new FlowEvent { type = FlowEventType.BombDefused, round = Round, site = BombSite });
        }

        /// <summary>GAME_RULES.md 2.1. Returns true when the round is over.</summary>
        public static bool EvaluateRoundEnd(bool detonated, bool defused, bool planted, int aliveAttackers, int aliveDefenders,
            float roundTimeLeft, out Side winner, out RoundEndReason reason)
        {
            winner = Side.Defense;
            reason = RoundEndReason.None;
            if (detonated) { winner = Side.Attack; reason = RoundEndReason.BombDetonated; return true; }
            if (defused) { winner = Side.Defense; reason = RoundEndReason.BombDefused; return true; }
            if (!planted && aliveAttackers == 0) { winner = Side.Defense; reason = RoundEndReason.Elimination; return true; }
            if (aliveDefenders == 0) { winner = Side.Attack; reason = RoundEndReason.Elimination; return true; }
            if (!planted && roundTimeLeft <= 0f) { winner = Side.Defense; reason = RoundEndReason.TimeExpired; return true; }
            return false;
        }

        void BeginRound(EconomyReset reset)
        {
            BombPlanted = BombDefused = BombDetonated = false;
            BombSite = -1;
            RoundTimeLeft = r.roundSeconds;
            BombTimeLeft = 0f;
            LiveElapsed = 0f;
            PhaseTimeLeft = r.buyPhaseSeconds + (Round == 1 ? m.firstRoundExtraBuySeconds : 0f);
            if (InOvertime && !overtimeAnnounced)
            {
                overtimeAnnounced = true;
                Emit(new FlowEvent { type = FlowEventType.OvertimeStarted, round = Round });
            }
            Emit(new FlowEvent { type = FlowEventType.RoundStarted, round = Round, reset = reset });
            SetPhase(MatchPhase.BuyPhase);
        }

        void EndRound(TeamId winner, RoundEndReason reason)
        {
            TeamId loser = Ids.Other(winner);
            Side winnerSide = SideOf(winner);
            LastWinner = winner;
            LastReason = reason;
            Score[(int)winner]++;
            LossStreak[(int)winner] = EconomyRules.NextLossStreak(LossStreak[(int)winner], true);
            LossStreak[(int)loser] = EconomyRules.NextLossStreak(LossStreak[(int)loser], false);

            int played = Round;
            pendingSwap = false;
            pendingMatchEnd = false;
            if (!InOvertime)
            {
                if (Score[0] >= m.roundsToWin || Score[1] >= m.roundsToWin)
                    DecideWinner(Score[0] >= m.roundsToWin ? TeamId.A : TeamId.B);
                else if (m.overtimeEnabled && Score[0] == m.roundsToWin - 1 && Score[1] == m.roundsToWin - 1)
                    InOvertime = true;
                else if (played >= RegulationRounds)
                    DecideByScore();
                else if (played == m.halftimeAfterRound)
                    pendingSwap = true;
            }
            else
            {
                OvertimeRoundsPlayed++;
                int lead = Score[0] - Score[1];
                if (lead < 0) lead = -lead;
                if (lead >= m.overtimeWinMargin)
                    DecideWinner(Score[0] > Score[1] ? TeamId.A : TeamId.B);
                else if (OvertimeRoundsPlayed >= m.maxOvertimeRounds)
                    DecideByScore();
                else if (OvertimeRoundsPlayed % (m.overtimeSwapEveryRounds < 1 ? 1 : m.overtimeSwapEveryRounds) == 0)
                    pendingSwap = true;
            }

            Emit(new FlowEvent
            {
                type = FlowEventType.RoundEnded, team = winner, side = winnerSide, reason = reason, round = played,
                bombPlanted = BombPlanted,
            });
            PhaseTimeLeft = r.roundEndSeconds;
            SetPhase(MatchPhase.RoundEnd);
        }

        void DecideWinner(TeamId t)
        {
            pendingMatchEnd = true;
            Winner = t;
            IsDraw = false;
        }

        void DecideByScore()
        {
            pendingMatchEnd = true;
            IsDraw = Score[0] == Score[1];
            Winner = Score[0] >= Score[1] ? TeamId.A : TeamId.B;
        }

        void FinishRoundEnd()
        {
            if (pendingMatchEnd)
            {
                SetPhase(MatchPhase.MatchOver);
                Emit(new FlowEvent { type = FlowEventType.MatchEnded, team = Winner, draw = IsDraw, round = Round });
                return;
            }
            if (pendingSwap)
            {
                pendingSwap = false;
                swappedBeforeNextRound = true;
                SideOfA = Ids.Other(SideOfA);
                Emit(new FlowEvent { type = FlowEventType.SidesSwapped, round = Round, side = SideOfA });
                if (!InOvertime && m.halftimeSeconds > 0f)
                {
                    PhaseTimeLeft = m.halftimeSeconds;
                    SetPhase(MatchPhase.Halftime);
                    return;
                }
            }
            NextRound();
        }

        void NextRound()
        {
            Round++;
            EconomyReset reset;
            if (InOvertime) reset = swappedBeforeNextRound ? EconomyReset.OvertimeMoneyAndClear : EconomyReset.OvertimeMoney;
            else reset = swappedBeforeNextRound ? EconomyReset.StartMoney : EconomyReset.None;
            if (reset != EconomyReset.None) LossStreak[0] = LossStreak[1] = 0;
            swappedBeforeNextRound = false;
            BeginRound(reset);
        }

        void SetPhase(MatchPhase p)
        {
            Phase = p;
            Emit(new FlowEvent { type = FlowEventType.PhaseChanged, phase = p, round = Round });
        }

        void Emit(FlowEvent e) => pending.Add(e);

        List<FlowEvent> Drain()
        {
            var list = new List<FlowEvent>(pending);
            pending.Clear();
            return list;
        }
    }
}
