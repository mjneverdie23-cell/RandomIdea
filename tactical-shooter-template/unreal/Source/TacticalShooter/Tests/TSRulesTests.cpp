// Automation tests (Window > Test Automation, or the command line:
//   UnrealEditor-Cmd TacticalShooter.uproject -ExecCmds="Automation RunTests TacticalShooter; Quit" -nullrhi -unattended
// They replay shared/tests/rules_vectors.json - the same vectors the Unity EditMode tests and
// tools/ue-core-check replay - and check that Content/Data is an up-to-date copy of shared/.

#include "CoreMinimal.h"
#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "Core/TSGameData.h"
#include "Core/TSKeyNames.h"
#include "Core/TSMapGrid.h"
#include "Core/TSMatchFlow.h"
#include "Core/TSNavGrid.h"
#include "Core/TSRng.h"
#include "Core/TSRules.h"
#include "Core/TSSynth.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace TSTests
{
	/** <repo>/tactical-shooter-template/shared (the Unreal project sits next to it). */
	FString SharedDir()
	{
		return FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectDir(), TEXT(".."), TEXT("shared")));
	}

	FString ContentDataDir()
	{
		return FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Data")));
	}

	FTSGameData LoadFrom(const FString& ConfigDir, const FString& MapsDir)
	{
		return FTSGameData::Load([&ConfigDir, &MapsDir](const FString& Key, FString& OutText)
		{
			FString Folder, Name;
			Key.Split(TEXT("/"), &Folder, &Name);
			const FString& Dir = Folder == TEXT("Maps") ? MapsDir : ConfigDir;
			return FFileHelper::LoadFileToString(OutText, *FPaths::Combine(Dir, Name + TEXT(".json")));
		});
	}

	TArray<TSharedPtr<FJsonObject>> Objects(const TSharedPtr<FJsonObject>& Root, const TCHAR* Field)
	{
		TArray<TSharedPtr<FJsonObject>> Out;
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (Root.IsValid() && Root->TryGetArrayField(Field, Values))
			for (const TSharedPtr<FJsonValue>& V : *Values) Out.Add(V->AsObject());
		return Out;
	}

	TArray<double> Numbers(const TSharedPtr<FJsonObject>& O, const TCHAR* Field)
	{
		TArray<double> Out;
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (O->TryGetArrayField(Field, Values))
			for (const TSharedPtr<FJsonValue>& V : *Values) Out.Add(V->AsNumber());
		return Out;
	}

	bool Near(double A, double B, double Tolerance) { return FMath::Abs(A - B) <= Tolerance; }

	const TCHAR* const CellTypeIds[] = { TEXT("wall"), TEXT("floor"), TEXT("lowCover"), TEXT("highCover"), TEXT("siteA"), TEXT("siteB"), TEXT("attackSpawn"), TEXT("defenseSpawn") };
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTSSharedVectorsTest, "TacticalShooter.Rules.SharedVectors",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FTSSharedVectorsTest::RunTest(const FString& Parameters)
{
	using namespace TSTests;
	int32 Checks = 0, Failures = 0;
	auto Check = [this, &Checks, &Failures](bool bOk, const FString& What)
	{
		++Checks;
		if (bOk) return;
		if (++Failures <= 50) AddError(What);
	};

	const FString Shared = SharedDir();
	const FTSGameData D = LoadFrom(FPaths::Combine(Shared, TEXT("config")), FPaths::Combine(Shared, TEXT("maps")));
	for (const FString& E : D.LoadErrors) Check(false, TEXT("load: ") + E);
	for (const FString& E : D.Validate()) Check(false, TEXT("config: ") + E);
	if (D.LoadErrors.Num() > 0) return false;
	const FTSGameConfig& G = D.Game;

	FString VectorText;
	if (!FFileHelper::LoadFileToString(VectorText, *FPaths::Combine(Shared, TEXT("tests"), TEXT("rules_vectors.json"))))
	{
		AddError(TEXT("shared/tests/rules_vectors.json not found (run shared/tools/generate_vectors.py)"));
		return false;
	}
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(VectorText);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		AddError(TEXT("rules_vectors.json is not valid JSON"));
		return false;
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("economy")))
		Check(TSEconomy::RoundIncome(G.Economy, V->GetBoolField(TEXT("won")), V->GetIntegerField(TEXT("lossStreak")),
			V->GetBoolField(TEXT("isAttacker")), V->GetBoolField(TEXT("bombPlanted"))) == V->GetIntegerField(TEXT("expected")), TEXT("economy"));

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("killReward")))
		Check(TSEconomy::KillReward(G.Economy, D.Weapon(V->GetStringField(TEXT("weaponId")))) == V->GetIntegerField(TEXT("expected")),
			TEXT("kill reward ") + V->GetStringField(TEXT("weaponId")));

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("hitZone")))
		Check(TSIds::ToId(TSDamage::ZoneFromHeight(G.Combat, (float)V->GetNumberField(TEXT("hitHeight")), (float)V->GetNumberField(TEXT("height"))))
			== V->GetStringField(TEXT("expected")), TEXT("hit zone"));

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("damage")))
	{
		const FTSWeaponDef* W = D.Weapon(V->GetStringField(TEXT("weaponId")));
		if (W == nullptr) { Check(false, TEXT("unknown weapon ") + V->GetStringField(TEXT("weaponId"))); continue; }
		const float Raw = TSDamage::RawDamage(*W, TSIds::ParseZone(V->GetStringField(TEXT("zone"))), (float)V->GetNumberField(TEXT("distance")));
		const FTSDamageResult R = TSDamage::ApplyArmor(G.Combat, Raw, V->GetIntegerField(TEXT("armor")), W->ArmorPenetration,
			(float)V->GetNumberField(TEXT("damageTakenMultiplier")));
		Check(R.HealthDamage == V->GetIntegerField(TEXT("expectedHealth")) && R.ArmorDamage == V->GetIntegerField(TEXT("expectedArmor")),
			FString::Printf(TEXT("damage %s %s d=%.2f armor=%d got %d/%d"), *W->Id, *V->GetStringField(TEXT("zone")),
				V->GetNumberField(TEXT("distance")), V->GetIntegerField(TEXT("armor")), R.HealthDamage, R.ArmorDamage));
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("areaDamage")))
	{
		const FTSDamageResult R = TSDamage::ApplyArmor(G.Combat, (float)V->GetNumberField(TEXT("raw")), V->GetIntegerField(TEXT("armor")),
			(float)V->GetNumberField(TEXT("armorPenetration")));
		Check(R.HealthDamage == V->GetIntegerField(TEXT("expectedHealth")) && R.ArmorDamage == V->GetIntegerField(TEXT("expectedArmor")), TEXT("area damage"));
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("spread")))
	{
		FTSSpreadInput In;
		In.HorizontalSpeed = (float)V->GetNumberField(TEXT("speed"));
		In.bAirborne = V->GetBoolField(TEXT("airborne"));
		In.bCrouched = V->GetBoolField(TEXT("crouched"));
		In.bAiming = V->GetBoolField(TEXT("aiming"));
		In.ShotIndex = V->GetIntegerField(TEXT("shotIndex"));
		const FTSWeaponDef* W = D.Weapon(V->GetStringField(TEXT("weaponId")));
		Check(W && Near(TSWeaponMath::Spread(*W, G.Movement, In), V->GetNumberField(TEXT("expected")), 1e-4),
			TEXT("spread ") + V->GetStringField(TEXT("weaponId")));
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("recoil")))
	{
		const FTSWeaponDef* W = D.Weapon(V->GetStringField(TEXT("weaponId")));
		float Pitch = 0.f, Yaw = 0.f;
		if (W) TSWeaponMath::RecoilKick(*W, V->GetIntegerField(TEXT("shotIndex")), Pitch, Yaw);
		Check(W && Near(Pitch, V->GetNumberField(TEXT("expectedPitch")), 1e-5) && Near(Yaw, V->GetNumberField(TEXT("expectedYaw")), 1e-5),
			TEXT("recoil ") + V->GetStringField(TEXT("weaponId")));
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("roundEnd")))
	{
		ETSSide Side;
		ETSRoundEndReason Reason;
		const bool bEnded = FTSMatchFlow::EvaluateRoundEnd(V->GetBoolField(TEXT("detonated")), V->GetBoolField(TEXT("defused")),
			V->GetBoolField(TEXT("planted")), V->GetIntegerField(TEXT("aliveAttackers")), V->GetIntegerField(TEXT("aliveDefenders")),
			(float)V->GetNumberField(TEXT("roundTimeLeft")), Side, Reason);
		Check((bEnded ? TSIds::ToId(Side) : FString(TEXT("none"))) == V->GetStringField(TEXT("expectedWinnerSide"))
			&& TSIds::ToId(Reason) == V->GetStringField(TEXT("expectedReason")), TEXT("round end"));
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("matchFlow")))
	{
		const FString Name = V->GetStringField(TEXT("name"));
		FTSMatchSettings M = G.Match;
		M.RoundsToWin = V->GetIntegerField(TEXT("roundsToWin"));
		M.HalftimeAfterRound = V->GetIntegerField(TEXT("halftimeAfterRound"));
		M.OvertimeEnabled = V->GetBoolField(TEXT("overtimeEnabled"));
		M.OvertimeWinMargin = V->GetIntegerField(TEXT("overtimeWinMargin"));
		M.OvertimeSwapEveryRounds = V->GetIntegerField(TEXT("overtimeSwapEveryRounds"));
		M.MaxOvertimeRounds = V->GetIntegerField(TEXT("maxOvertimeRounds"));
		FTSMatchFlow Flow(M, G.Round, G.Bomb);
		FString Resets;
		TArray<int32> Swaps;
		auto Process = [&Resets, &Swaps](const TArray<FTSFlowEvent>& Events)
		{
			for (const FTSFlowEvent& E : Events)
			{
				if (E.Type == ETSFlowEventType::RoundStarted)
					Resets += E.Reset == ETSEconomyReset::StartMoney ? TEXT("S") : E.Reset == ETSEconomyReset::OvertimeMoney ? TEXT("O")
						: E.Reset == ETSEconomyReset::OvertimeMoneyAndClear ? TEXT("C") : TEXT(".");
				if (E.Type == ETSFlowEventType::SidesSwapped) Swaps.Add(E.Round);
			}
		};
		FTSRoundSnapshot Idle;
		Idle.AliveAttackers = Idle.AliveDefenders = 5;
		Process(Flow.Start(TSIds::ParseSide(V->GetStringField(TEXT("startSideA")))));
		const FString Winners = V->GetStringField(TEXT("winners"));
		for (int32 Index = 0; Index < Winners.Len(); ++Index)
		{
			const TCHAR W = Winners[Index];
			int32 Guard = 0;
			while (Flow.Phase == ETSMatchPhase::BuyPhase && Guard++ < 1000) Process(Flow.Tick(1.f, Idle));
			const ETSTeam Team = W == TEXT('A') ? ETSTeam::A : ETSTeam::B;
			FTSRoundSnapshot Snap;
			if (Flow.SideOf(Team) == ETSSide::Attack) { Snap.AliveAttackers = 3; Snap.AliveDefenders = 0; }
			else { Snap.AliveAttackers = 0; Snap.AliveDefenders = 3; }
			Process(Flow.Tick(0.1f, Snap));
			Check(Flow.Phase == ETSMatchPhase::RoundEnd && Flow.LastWinner == Team, Name + TEXT(": round did not end as scripted"));
			Guard = 0;
			while ((Flow.Phase == ETSMatchPhase::RoundEnd || Flow.Phase == ETSMatchPhase::Halftime) && Guard++ < 1000) Process(Flow.Tick(1.f, Idle));
		}
		const FString Winner = Flow.bIsDraw ? TEXT("draw") : (Flow.Winner == ETSTeam::A ? TEXT("A") : TEXT("B"));
		TArray<int32> ExpectedSwaps;
		for (const double S : Numbers(V, TEXT("expectedSwapsAfterRounds"))) ExpectedSwaps.Add((int32)S);
		Check(Flow.IsMatchOver(), Name + TEXT(": not over"));
		Check(Winner == V->GetStringField(TEXT("expectedWinner")), Name + TEXT(": winner ") + Winner);
		Check(Flow.Round == V->GetIntegerField(TEXT("expectedRoundsPlayed")) && Flow.Score[0] == V->GetIntegerField(TEXT("expectedScoreA"))
			&& Flow.Score[1] == V->GetIntegerField(TEXT("expectedScoreB")), Name + TEXT(": score/rounds"));
		Check(Swaps == ExpectedSwaps, Name + TEXT(": swaps"));
		Check(Resets.Equals(V->GetStringField(TEXT("expectedResets")), ESearchCase::CaseSensitive), Name + TEXT(": resets ") + Resets);
		Check(TSIds::ToId(Flow.SideOfA) == V->GetStringField(TEXT("expectedFinalSideA")) && Flow.bInOvertime == V->GetBoolField(TEXT("expectedOvertime")),
			Name + TEXT(": final side / overtime"));
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("maps")))
	{
		const FTSMapDef* Def = D.Map(V->GetStringField(TEXT("mapId")));
		if (Def == nullptr) { Check(false, TEXT("unknown map")); continue; }
		TArray<FString> Errors;
		const FTSMapGrid Grid = FTSMapGrid::Parse(*Def, Errors);
		Check(Errors.Num() == 0, TEXT("map parse errors"));
		Check(Grid.Width == V->GetIntegerField(TEXT("width")) && Grid.Height == V->GetIntegerField(TEXT("height")), TEXT("map size"));
		const TSharedPtr<FJsonObject> Counts = V->GetObjectField(TEXT("cellCounts"));
		const TSharedPtr<FJsonObject> Boxes = V->GetObjectField(TEXT("boxCounts"));
		for (int32 T = 0; T < 8; ++T)
		{
			Check(Grid.Count((ETSCellType)T) == Counts->GetIntegerField(CellTypeIds[T]), FString(TEXT("cell count ")) + CellTypeIds[T]);
			Check(Grid.Boxes((ETSCellType)T).Num() == Boxes->GetIntegerField(CellTypeIds[T]), FString(TEXT("box count ")) + CellTypeIds[T]);
		}
		for (const TSharedPtr<FJsonObject>& C : Objects(V, TEXT("centers")))
			Check(Near(Grid.East(C->GetIntegerField(TEXT("x"))), C->GetNumberField(TEXT("east")), 1e-4)
				&& Near(Grid.North(C->GetIntegerField(TEXT("y"))), C->GetNumberField(TEXT("north")), 1e-4), TEXT("cell centre"));
		for (const TSharedPtr<FJsonObject>& C : Objects(V, TEXT("cellAt")))
		{
			const FTSCell Cell = Grid.CellAt((float)C->GetNumberField(TEXT("east")), (float)C->GetNumberField(TEXT("north")));
			Check(Cell.X == C->GetIntegerField(TEXT("expectedX")) && Cell.Y == C->GetIntegerField(TEXT("expectedY")), TEXT("cellAt"));
		}
		FTSNavGrid Nav(Grid);
		TArray<FTSCell> Path;
		for (const TSharedPtr<FJsonObject>& P : Objects(V, TEXT("paths")))
		{
			const bool bFound = Nav.FindPath(FTSCell(P->GetIntegerField(TEXT("fromX")), P->GetIntegerField(TEXT("fromY"))),
				FTSCell(P->GetIntegerField(TEXT("toX")), P->GetIntegerField(TEXT("toY"))), Path);
			Check(bFound == P->GetBoolField(TEXT("found")), TEXT("path found"));
			if (!bFound) continue;
			Check(Near(Nav.LastPathCost, P->GetNumberField(TEXT("expectedCost")), 1e-3), FString::Printf(TEXT("path cost %f"), Nav.LastPathCost));
			const TArray<FTSCell> Smooth = Nav.Smooth(Path);
			for (int32 i = 0; i + 1 < Smooth.Num(); ++i)
			{
				const bool bNeighbour = FMath::Abs(Smooth[i].X - Smooth[i + 1].X) <= 1 && FMath::Abs(Smooth[i].Y - Smooth[i + 1].Y) <= 1;
				Check(bNeighbour || Nav.ClearLine(Smooth[i], Smooth[i + 1]), TEXT("smoothed segment crosses a wall"));
			}
		}
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("rng")))
	{
		const uint32 Seed = (uint32)V->GetNumberField(TEXT("seed"));
		const TArray<double> Ints = Numbers(V, TEXT("expectedInts"));
		const TArray<double> Floats = Numbers(V, TEXT("expectedFloats"));
		FTSRng R(Seed), F(Seed);
		for (int32 i = 0; i < Ints.Num(); ++i) Check(R.NextUInt() == (uint32)Ints[i], TEXT("rng int"));
		for (int32 i = 0; i < Floats.Num(); ++i) Check(Near(F.NextFloat(), Floats[i], 1e-6), TEXT("rng float"));
	}

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("hash")))
		Check(TSFnv1a(V->GetStringField(TEXT("text"))) == (uint32)V->GetNumberField(TEXT("expected")), TEXT("hash ") + V->GetStringField(TEXT("text")));

	for (const TSharedPtr<FJsonObject>& V : Objects(Root, TEXT("synth")))
	{
		const FTSAudioCue* Cue = D.Cue(V->GetStringField(TEXT("cueId")));
		if (Cue == nullptr) { Check(false, TEXT("unknown cue")); continue; }
		const TArray<float> Samples = TSSynth::Generate(*Cue, V->GetIntegerField(TEXT("sampleRate")));
		Check(Samples.Num() == V->GetIntegerField(TEXT("expectedCount")), TEXT("synth count ") + Cue->Id);
		const TArray<double> Indices = Numbers(V, TEXT("indices"));
		const TArray<double> Values = Numbers(V, TEXT("expectedValues"));
		for (int32 i = 0; i < Indices.Num() && i < Values.Num(); ++i)
		{
			const int32 Index = (int32)Indices[i];
			Check(Samples.IsValidIndex(Index) && Near(Samples[Index], Values[i], 2e-4), TEXT("synth sample ") + Cue->Id);
		}
	}

	for (const TSharedPtr<FJsonObject>& C : Objects(Root, TEXT("shop")))
	{
		const FString Name = C->GetStringField(TEXT("name"));
		const FTSAgentDef* Agent = D.Agent(C->GetStringField(TEXT("agentId")));
		const ETSSide Side = TSIds::ParseSide(C->GetStringField(TEXT("side")));
		FTSLoadout Lo(G.Loadout.DefaultSecondary);
		Lo.PrimaryId = C->GetStringField(TEXT("initialPrimary"));
		Lo.Armor = C->GetIntegerField(TEXT("initialArmor"));
		int32 Money = C->GetIntegerField(TEXT("initialMoney"));
		int32 Step = 0;
		for (const TSharedPtr<FJsonObject>& S : Objects(C, TEXT("steps")))
		{
			const FString Op = S->GetStringField(TEXT("op"));
			const FString Item = S->GetStringField(TEXT("item"));
			const FTSShopOutcome O = Op == TEXT("buy") ? TSShop::Buy(D, Agent, Side, Lo, Money, Item) : TSShop::Sell(D, Lo, Money, Item);
			Money = O.Money;
			const FString What = FString::Printf(TEXT("%s step %d %s %s"), *Name, Step++, *Op, *Item);
			Check(TSIds::ToId(O.Result).Equals(S->GetStringField(TEXT("expectedResult")), ESearchCase::CaseSensitive), What + TEXT(" result ") + TSIds::ToId(O.Result));
			Check(Money == S->GetIntegerField(TEXT("expectedMoney")), What + TEXT(" money"));
			Check(O.DroppedWeaponId == S->GetStringField(TEXT("expectedDropped")), What + TEXT(" dropped"));
			Check(Lo.PrimaryId == S->GetStringField(TEXT("expectedPrimary")) && Lo.SecondaryId == S->GetStringField(TEXT("expectedSecondary")), What + TEXT(" weapons"));
			Check(Lo.Armor == S->GetIntegerField(TEXT("expectedArmor")) && Lo.bHasDefuseKit == S->GetBoolField(TEXT("expectedKit")), What + TEXT(" armor/kit"));
			const TArray<double> Charges = Numbers(S, TEXT("expectedCharges"));
			for (int32 k = 0; k < 4 && k < Charges.Num(); ++k) Check(Lo.AbilityCharges[k] == (int32)Charges[k], What + TEXT(" charges"));
		}
	}

	AddInfo(FString::Printf(TEXT("%d checks, %d failures"), Checks, Failures));
	return Failures == 0;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTSGameplayInvariantsTest, "TacticalShooter.Rules.Invariants",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FTSGameplayInvariantsTest::RunTest(const FString& Parameters)
{
	using namespace TSTests;
	const FString Shared = SharedDir();
	const FTSGameData D = LoadFrom(FPaths::Combine(Shared, TEXT("config")), FPaths::Combine(Shared, TEXT("maps")));
	if (!TestEqual(TEXT("load errors"), D.LoadErrors.Num(), 0)) return false;
	const FTSGameConfig& G = D.Game;
	FTSRng Rng(42);

	// Bots never make an illegal purchase and never sit on a full buy.
	for (const FTSAgentDef& Agent : D.Agents)
	{
		for (const ETSSide Side : { ETSSide::Attack, ETSSide::Defense })
		{
			for (int32 Trial = 0; Trial < 50; ++Trial)
			{
				int32 Money = Rng.RangeInt(0, G.Economy.MaxMoney + 1);
				FTSLoadout Lo(G.Loadout.DefaultSecondary);
				for (const FString& Item : TSBotBuy::Plan(D, &Agent, Side, Lo, Money, Rng))
				{
					const FTSShopOutcome O = TSShop::Buy(D, &Agent, Side, Lo, Money, Item);
					if (!TestTrue(TEXT("bot purchase is legal: ") + Item, O.Ok())) return false;
					Money = O.Money;
				}
				if (!TestFalse(TEXT("bot saved a full buy"), Lo.PrimaryId.IsEmpty() && Money >= D.Bots.Buy.FullBuyMoney)) return false;
			}
		}
	}

	// Random matches always end, with exactly one point per round.
	for (int32 Match = 0; Match < 200; ++Match)
	{
		FTSMatchFlow Flow(G.Match, G.Round, G.Bomb);
		Flow.Start(Rng.Chance(0.5f) ? ETSSide::Attack : ETSSide::Defense);
		int32 Ticks = 0;
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
		if (!TestTrue(TEXT("random match ends with one point per round"), Flow.IsMatchOver() && Flow.Round == Flow.Score[0] + Flow.Score[1])) return false;
	}

	// Every default key name is known to the player controller's key table.
	for (const FTSKeyBinding& B : D.Input.Bindings)
	{
		TestTrue(TEXT("key name ") + B.Key, TSKeyNames::IsValid(B.Key));
		TestTrue(TEXT("alt key name ") + B.AltKey, B.AltKey.IsEmpty() || TSKeyNames::IsValid(B.AltKey));
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTSContentDataSyncTest, "TacticalShooter.Data.ContentMatchesShared",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FTSContentDataSyncTest::RunTest(const FString& Parameters)
{
	using namespace TSTests;
	const FString Shared = SharedDir();
	const FString Content = ContentDataDir();
	struct FFolder { const TCHAR* Key; const TCHAR* Value; };
	const FFolder Folders[] = { { TEXT("config"), TEXT("Config") }, { TEXT("maps"), TEXT("Maps") } };
	int32 Compared = 0;
	for (const FFolder& Folder : Folders)
	{
		TArray<FString> Files;
		IFileManager::Get().FindFiles(Files, *FPaths::Combine(Shared, Folder.Key, TEXT("*.json")), true, false);
		for (const FString& File : Files)
		{
			FString A, B;
			FFileHelper::LoadFileToString(A, *FPaths::Combine(Shared, Folder.Key, File));
			const bool bCopied = FFileHelper::LoadFileToString(B, *FPaths::Combine(Content, Folder.Value, File));
			TestTrue(FString::Printf(TEXT("Content/Data/%s/%s exists (run shared/tools/sync_shared.py)"), Folder.Value, *File), bCopied);
			if (bCopied) TestTrue(FString::Printf(TEXT("Content/Data/%s/%s matches shared/ (run shared/tools/sync_shared.py)"), Folder.Value, *File),
				A.Equals(B, ESearchCase::CaseSensitive));
			++Compared;
		}
	}
	TestTrue(TEXT("found shared/config"), Compared > 0);

	// The copy the game actually loads must be valid too.
	const FTSGameData D = LoadFrom(FPaths::Combine(Content, TEXT("Config")), FPaths::Combine(Content, TEXT("Maps")));
	for (const FString& E : D.LoadErrors) AddError(TEXT("load: ") + E);
	for (const FString& E : D.Validate()) AddError(TEXT("config: ") + E);
	return !HasAnyErrors();
}

#endif // WITH_DEV_AUTOMATION_TESTS
