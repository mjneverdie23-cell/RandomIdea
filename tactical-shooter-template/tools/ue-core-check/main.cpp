// Compiles the engine-free Unreal core (unreal/Source/TacticalShooter/Core) with a plain C++17
// compiler and replays shared/tests/rules_vectors.json against it - the same vectors the Unity
// tests replay. Run: tools/ue-core-check/run.sh
#include "TSGameData.h"
#include "TSKeyNames.h"
#include "TSMapGrid.h"
#include "TSMatchFlow.h"
#include "TSNavGrid.h"
#include "TSRng.h"
#include "TSRules.h"
#include "TSSynth.h"

#include <cstdio>
#include <string>

struct FEconomyV { bool Won; int LossStreak; bool IsAttacker; bool BombPlanted; int Expected; };
struct FKillRewardV { const char* WeaponId; int Expected; };
struct FHitZoneV { double HitHeight; double Height; const char* Expected; };
struct FDamageV { const char* WeaponId; const char* Zone; double Distance; int Armor; double Mult; int ExpectedHealth; int ExpectedArmor; };
struct FAreaDamageV { double Raw; int Armor; double Pen; int ExpectedHealth; int ExpectedArmor; };
struct FSpreadV { const char* WeaponId; double Speed; bool Airborne; bool Crouched; bool Aiming; int ShotIndex; double Expected; };
struct FRecoilV { const char* WeaponId; int ShotIndex; double Pitch; double Yaw; };
struct FRoundEndV { bool Det; bool Def; bool Planted; int Att; int Dfn; double TimeLeft; const char* Side; const char* Reason; };
struct FMatchFlowV
{
	const char* Name; const char* StartSide; int RoundsToWin; int Halftime; bool Overtime; int Margin; int SwapEvery; int MaxOt;
	const char* Winners; const char* Winner; int Rounds; int ScoreA; int ScoreB; const char* Swaps; const char* Resets; const char* FinalSide; bool InOt;
};
struct FMapV { const char* Id; int Width; int Height; int Counts[8]; int Boxes[8]; };
struct FCenterV { const char* Id; int X; int Y; double East; double North; };
struct FCellAtV { const char* Id; double East; double North; int X; int Y; };
struct FPathV { const char* Id; int FX; int FY; int TX; int TY; bool Found; double Cost; };
struct FRngV { uint32 Seed; uint32 Ints[5]; double Floats[5]; };
struct FHashV { const char* Text; uint32 Expected; };
struct FSynthV { const char* Cue; int Rate; int Count; int Indices[6]; double Values[6]; };
struct FShopStepV
{
	const char* Op; const char* Item; const char* Result; int Money; const char* Dropped; const char* Primary; const char* Secondary;
	int Armor; bool Kit; int Charges[4];
};
struct FShopCaseV { const char* Name; const char* Agent; const char* Side; int Money; const char* Primary; int Armor; int First; int Count; };

#include "build/generated_data.inc"
#include "build/generated_vectors.inc"

static int GChecks = 0;
static int GFailures = 0;

static void Expect(bool bOk, const std::string& What)
{
	++GChecks;
	if (!bOk)
	{
		++GFailures;
		if (GFailures <= 40) std::printf("FAIL: %s\n", What.c_str());
	}
}

static bool Near(double A, double B, double Tol) { return std::fabs(A - B) <= Tol; }
static std::string S(const FString& F) { return F.Std(); }

int main()
{
	const FTSGameData D = MakeGameData();
	const FTSGameConfig& G = D.Game;

	for (const FString& E : D.Validate()) Expect(false, "config: " + S(E));

	for (const FEconomyV& V : GEconomy)
		Expect(TSEconomy::RoundIncome(G.Economy, V.Won, V.LossStreak, V.IsAttacker, V.BombPlanted) == V.Expected, "economy");
	for (const FKillRewardV& V : GKillReward)
		Expect(TSEconomy::KillReward(G.Economy, D.Weapon(V.WeaponId)) == V.Expected, std::string("kill reward ") + V.WeaponId);

	for (const FHitZoneV& V : GHitZone)
		Expect(TSIds::ToId(TSDamage::ZoneFromHeight(G.Combat, (float)V.HitHeight, (float)V.Height)) == V.Expected, "hit zone");

	for (const FDamageV& V : GDamage)
	{
		const FTSWeaponDef* W = D.Weapon(V.WeaponId);
		const float Raw = TSDamage::RawDamage(*W, TSIds::ParseZone(V.Zone), (float)V.Distance);
		const FTSDamageResult R = TSDamage::ApplyArmor(G.Combat, Raw, V.Armor, W->ArmorPenetration, (float)V.Mult);
		Expect(R.HealthDamage == V.ExpectedHealth && R.ArmorDamage == V.ExpectedArmor,
			std::string("damage ") + V.WeaponId + " " + V.Zone + " d=" + std::to_string(V.Distance) + " armor=" + std::to_string(V.Armor) +
			" got " + std::to_string(R.HealthDamage) + "/" + std::to_string(R.ArmorDamage));
	}
	for (const FAreaDamageV& V : GAreaDamage)
	{
		const FTSDamageResult R = TSDamage::ApplyArmor(G.Combat, (float)V.Raw, V.Armor, (float)V.Pen);
		Expect(R.HealthDamage == V.ExpectedHealth && R.ArmorDamage == V.ExpectedArmor, "area damage");
	}

	for (const FSpreadV& V : GSpread)
	{
		FTSSpreadInput In;
		In.HorizontalSpeed = (float)V.Speed;
		In.bAirborne = V.Airborne;
		In.bCrouched = V.Crouched;
		In.bAiming = V.Aiming;
		In.ShotIndex = V.ShotIndex;
		Expect(Near(TSWeaponMath::Spread(*D.Weapon(V.WeaponId), G.Movement, In), V.Expected, 1e-4), std::string("spread ") + V.WeaponId);
	}
	for (const FRecoilV& V : GRecoil)
	{
		float P, Y;
		TSWeaponMath::RecoilKick(*D.Weapon(V.WeaponId), V.ShotIndex, P, Y);
		Expect(Near(P, V.Pitch, 1e-5) && Near(Y, V.Yaw, 1e-5), std::string("recoil ") + V.WeaponId);
	}

	for (const FRoundEndV& V : GRoundEnd)
	{
		ETSSide Side;
		ETSRoundEndReason Reason;
		const bool bEnded = FTSMatchFlow::EvaluateRoundEnd(V.Det, V.Def, V.Planted, V.Att, V.Dfn, (float)V.TimeLeft, Side, Reason);
		Expect((bEnded ? S(TSIds::ToId(Side)) : std::string("none")) == V.Side && S(TSIds::ToId(Reason)) == V.Reason, "round end");
	}

	for (const FMatchFlowV& V : GMatchFlow)
	{
		FTSMatchSettings M = G.Match;
		M.RoundsToWin = V.RoundsToWin;
		M.HalftimeAfterRound = V.Halftime;
		M.OvertimeEnabled = V.Overtime;
		M.OvertimeWinMargin = V.Margin;
		M.OvertimeSwapEveryRounds = V.SwapEvery;
		M.MaxOvertimeRounds = V.MaxOt;
		FTSMatchFlow Flow(M, G.Round, G.Bomb);
		std::string Resets, Swaps;
		auto Process = [&](const TArray<FTSFlowEvent>& Events)
		{
			for (const FTSFlowEvent& E : Events)
			{
				if (E.Type == ETSFlowEventType::RoundStarted)
					Resets += E.Reset == ETSEconomyReset::StartMoney ? 'S' : E.Reset == ETSEconomyReset::OvertimeMoney ? 'O' : E.Reset == ETSEconomyReset::OvertimeMoneyAndClear ? 'C' : '.';
				if (E.Type == ETSFlowEventType::SidesSwapped) Swaps += (Swaps.empty() ? "" : ",") + std::to_string(E.Round);
			}
		};
		FTSRoundSnapshot Idle;
		Idle.AliveAttackers = Idle.AliveDefenders = 5;
		Process(Flow.Start(TSIds::ParseSide(V.StartSide)));
		for (const char* W = V.Winners; *W; ++W)
		{
			int Guard = 0;
			while (Flow.Phase == ETSMatchPhase::BuyPhase && Guard++ < 1000) Process(Flow.Tick(1.f, Idle));
			const ETSTeam Team = *W == 'A' ? ETSTeam::A : ETSTeam::B;
			FTSRoundSnapshot Snap;
			if (Flow.SideOf(Team) == ETSSide::Attack) { Snap.AliveAttackers = 3; Snap.AliveDefenders = 0; }
			else { Snap.AliveAttackers = 0; Snap.AliveDefenders = 3; }
			Process(Flow.Tick(0.1f, Snap));
			Expect(Flow.Phase == ETSMatchPhase::RoundEnd && Flow.LastWinner == Team, std::string(V.Name) + ": round did not end as scripted");
			Guard = 0;
			while ((Flow.Phase == ETSMatchPhase::RoundEnd || Flow.Phase == ETSMatchPhase::Halftime) && Guard++ < 1000) Process(Flow.Tick(1.f, Idle));
		}
		const std::string Winner = Flow.bIsDraw ? "draw" : (Flow.Winner == ETSTeam::A ? "A" : "B");
		Expect(Flow.IsMatchOver(), std::string(V.Name) + ": not over");
		Expect(Winner == V.Winner, std::string(V.Name) + ": winner " + Winner);
		Expect(Flow.Round == V.Rounds && Flow.Score[0] == V.ScoreA && Flow.Score[1] == V.ScoreB, std::string(V.Name) + ": score/rounds");
		Expect(Swaps == V.Swaps, std::string(V.Name) + ": swaps " + Swaps);
		Expect(Resets == V.Resets, std::string(V.Name) + ": resets " + Resets);
		Expect(S(TSIds::ToId(Flow.SideOfA)) == V.FinalSide && Flow.bInOvertime == V.InOt, std::string(V.Name) + ": final side / overtime");
	}

	for (const FMapV& V : GMaps)
	{
		TArray<FString> Errors;
		const FTSMapGrid Grid = FTSMapGrid::Parse(*D.Map(V.Id), Errors);
		Expect(Errors.Num() == 0, "map parse errors");
		Expect(Grid.Width == V.Width && Grid.Height == V.Height, "map size");
		for (int T = 0; T < 8; ++T)
		{
			Expect(Grid.Count((ETSCellType)T) == V.Counts[T], "cell count " + std::to_string(T));
			Expect(Grid.Boxes((ETSCellType)T).Num() == V.Boxes[T], "box count " + std::to_string(T));
		}
		for (const FCenterV& C : GCenters)
			Expect(Near(Grid.East(C.X), C.East, 1e-4) && Near(Grid.North(C.Y), C.North, 1e-4), "cell centre");
		for (const FCellAtV& C : GCellAt)
		{
			const FTSCell Cell = Grid.CellAt((float)C.East, (float)C.North);
			Expect(Cell.X == C.X && Cell.Y == C.Y, "cellAt " + std::to_string(C.East) + "," + std::to_string(C.North));
		}
		FTSNavGrid Nav(Grid);
		TArray<FTSCell> Path;
		for (const FPathV& P : GPaths)
		{
			const bool bFound = Nav.FindPath(FTSCell(P.FX, P.FY), FTSCell(P.TX, P.TY), Path);
			Expect(bFound == P.Found, "path found");
			if (!bFound) continue;
			Expect(Near(Nav.LastPathCost, P.Cost, 1e-3), "path cost " + std::to_string(Nav.LastPathCost) + " vs " + std::to_string(P.Cost));
			const TArray<FTSCell> Smooth = Nav.Smooth(Path);
			for (int I = 0; I + 1 < Smooth.Num(); ++I)
			{
				const bool bNeighbour = std::abs(Smooth[I].X - Smooth[I + 1].X) <= 1 && std::abs(Smooth[I].Y - Smooth[I + 1].Y) <= 1;
				Expect(bNeighbour || Nav.ClearLine(Smooth[I], Smooth[I + 1]), "smoothed segment crosses a wall");
			}
		}
	}

	for (const FRngV& V : GRng)
	{
		FTSRng R(V.Seed), F(V.Seed);
		for (int I = 0; I < 5; ++I)
		{
			Expect(R.NextUInt() == V.Ints[I], "rng int");
			Expect(Near(F.NextFloat(), V.Floats[I], 1e-6), "rng float");
		}
	}
	for (const FHashV& V : GHash) Expect(TSFnv1a(V.Text) == V.Expected, std::string("hash ") + V.Text);

	for (const FSynthV& V : GSynth)
	{
		const TArray<float> Samples = TSSynth::Generate(*D.Cue(V.Cue), V.Rate);
		Expect(Samples.Num() == V.Count, std::string("synth count ") + V.Cue);
		for (int I = 0; I < 6 && Samples.Num() == V.Count; ++I)
			Expect(Near(Samples[V.Indices[I]], V.Values[I], 2e-4), std::string("synth sample ") + V.Cue);
	}

	for (const FShopCaseV& C : GShopCases)
	{
		const FTSAgentDef* Agent = D.Agent(C.Agent);
		const ETSSide Side = TSIds::ParseSide(C.Side);
		FTSLoadout Lo(G.Loadout.DefaultSecondary);
		Lo.PrimaryId = C.Primary;
		Lo.Armor = C.Armor;
		int32 Money = C.Money;
		for (int I = 0; I < C.Count; ++I)
		{
			const FShopStepV& St = GShopSteps[C.First + I];
			const FTSShopOutcome O = std::string(St.Op) == "buy" ? TSShop::Buy(D, Agent, Side, Lo, Money, St.Item) : TSShop::Sell(D, Lo, Money, St.Item);
			Money = O.Money;
			const std::string What = std::string(C.Name) + " step " + std::to_string(I) + " " + St.Op + " " + St.Item;
			Expect(S(TSIds::ToId(O.Result)) == St.Result, What + " result " + S(TSIds::ToId(O.Result)));
			Expect(Money == St.Money, What + " money");
			Expect(S(O.DroppedWeaponId) == St.Dropped, What + " dropped");
			Expect(S(Lo.PrimaryId) == St.Primary && S(Lo.SecondaryId) == St.Secondary, What + " weapons");
			Expect(Lo.Armor == St.Armor && Lo.bHasDefuseKit == St.Kit, What + " armor/kit");
			for (int K = 0; K < 4; ++K) Expect(Lo.AbilityCharges[K] == St.Charges[K], What + " charges");
		}
	}

	// Bots never make an illegal purchase and never hoard a full-buy worth of money.
	FTSRng Rng(42);
	for (const FTSAgentDef& Agent : D.Agents)
	{
		for (ETSSide Side : { ETSSide::Attack, ETSSide::Defense })
		{
			for (int Trial = 0; Trial < 50; ++Trial)
			{
				int32 Money = Rng.RangeInt(0, G.Economy.MaxMoney + 1);
				FTSLoadout Lo(G.Loadout.DefaultSecondary);
				for (const FString& Item : TSBotBuy::Plan(D, &Agent, Side, Lo, Money, Rng))
				{
					const FTSShopOutcome O = TSShop::Buy(D, &Agent, Side, Lo, Money, Item);
					Expect(O.Ok(), "bot bought something illegal: " + S(Item));
					Money = O.Money;
				}
				Expect(!(Lo.PrimaryId.IsEmpty() && Money >= D.Bots.Buy.FullBuyMoney), "bot saved a full buy");
			}
		}
	}

	// Random matches always end, one point per round.
	for (int Match = 0; Match < 200; ++Match)
	{
		FTSMatchFlow Flow(G.Match, G.Round, G.Bomb);
		Flow.Start(Rng.Chance(0.5f) ? ETSSide::Attack : ETSSide::Defense);
		int Ticks = 0;
		while (!Flow.IsMatchOver() && Ticks++ < 200000)
		{
			FTSRoundSnapshot Snap;
			Snap.AliveAttackers = Snap.AliveDefenders = 5;
			if (Flow.Phase == ETSMatchPhase::Live)
			{
				const float Roll = Rng.NextFloat();
				if (Roll < 0.05f) Snap.AliveAttackers = 0;
				else if (Roll < 0.10f) Snap.AliveDefenders = 0;
				else if (Roll < 0.12f) Flow.NotifyBombPlanted(Rng.RangeInt(0, 2));
				else if (Roll < 0.13f) Flow.NotifyBombDefused();
			}
			Flow.Tick(0.5f, Snap);
		}
		Expect(Flow.IsMatchOver() && Flow.Round == Flow.Score[0] + Flow.Score[1], "random match");
	}

	// Key names and the default bindings.
	for (const FTSKeyBinding& B : D.Input.Bindings) Expect(TSKeyNames::IsValid(B.Key), "key " + S(B.Key));
	FTSKeyMap Keys(D.Input, D.DefaultSettings.KeyOverrides);
	Expect(Keys.Key(TEXT("Fire")) == TEXT("Mouse1") && Keys.AltKey(TEXT("Pause")) == TEXT("P"), "key map");

	std::printf("%d checks, %d failures\n", GChecks, GFailures);
	return GFailures == 0 ? 0 : 1;
}
