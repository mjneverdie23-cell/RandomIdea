using System;

namespace TacticalShooter.Core
{
    /// <summary>Money rules, GAME_RULES.md section 3.</summary>
    public static class EconomyRules
    {
        public const int MaxLossStreak = 10;

        public static int LossBonus(EconomySettings e, int streak)
        {
            if (streak <= 0) return e.lossBase;
            return Math.Min(e.lossBase + (streak - 1) * e.lossStreakIncrement, e.lossMax);
        }

        /// <summary>Income for one player of a team at round end. lossStreak is the value after this round.</summary>
        public static int RoundIncome(EconomySettings e, bool won, int lossStreak, bool isAttacker, bool bombPlanted)
        {
            int baseIncome = won ? e.winReward : LossBonus(e, lossStreak);
            return baseIncome + (isAttacker && bombPlanted ? e.plantRewardTeam : 0);
        }

        public static int NextLossStreak(int streak, bool won) => won ? 0 : Math.Min(streak + 1, MaxLossStreak);

        /// <summary>weapon may be null for ability kills.</summary>
        public static int KillReward(EconomySettings e, WeaponDef weapon) =>
            weapon != null && weapon.killReward >= 0 ? weapon.killReward : e.defaultKillReward;

        public static int AddMoney(EconomySettings e, int current, int delta) => Math.Max(0, Math.Min(e.maxMoney, current + delta));
    }
}
