#include "Game/TSGameMode.h"
#include "TacticalShooter.h"
#include "Game/TSAudio.h"
#include "Game/TSCharacter.h"
#include "Game/TSGameSubsystem.h"
#include "Game/TSPlayerController.h"
#include "UI/TSHUD.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"

ATSGameMode::ATSGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = false;
	DefaultPawnClass = nullptr;
	PlayerControllerClass = ATSPlayerController::StaticClass();
	HUDClass = ATSHUD::StaticClass();
}

void ATSGameMode::BeginPlay()
{
	Super::BeginPlay();
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	Game->ApplySettings();

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Audio = GetWorld()->SpawnActor<ATSAudioHost>(FVector::ZeroVector, FRotator::ZeroRotator, Params);
	MenuCamera = GetWorld()->SpawnActor<ACameraActor>(FVector(0.f, 0.f, 5000.f), FRotator(-45.f, 0.f, 0.f), Params);
	if (MenuCamera) MenuCamera->GetCameraComponent()->SetFieldOfView(75.f);

	Effects.Mode = this;
	Combat.Mode = this;
	BuildMap(Game->Settings.MapId);
	if (ATSPlayerController* PC = LocalController()) PC->ShowMainMenu();
}

void ATSGameMode::EndPlay(const EEndPlayReason::Type Reason)
{
	EndMatch();
	Super::EndPlay(Reason);
}

ACameraActor* ATSGameMode::OverviewCamera() const
{
	return MenuCamera.Get();
}

ATSPlayerController* ATSGameMode::LocalController() const
{
	return Cast<ATSPlayerController>(UGameplayStatics::GetPlayerController(this, 0));
}

void ATSGameMode::BuildMap(const FString& MapId)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSMapDef* Def = Game->Data().Map(MapId);
	if (Def == nullptr)
	{
		UE_LOG(LogTacticalShooter, Error, TEXT("No map data. Check Content/Data/Maps and game.json mapRotation."));
		return;
	}
	if (MapActor != nullptr && BuiltMapId == Def->Id) return;
	if (MapActor != nullptr) MapActor->Destroy();
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	MapActor = GetWorld()->SpawnActor<ATSMapActor>(FVector::ZeroVector, FRotator::ZeroRotator, Params);
	World = MapActor->Build(*Def);
	BuiltMapId = Def->Id;
}

// ---------------------------------------------------------------------------------- lifecycle

void ATSGameMode::StartMatch(const FTSMatchOptions& InOptions)
{
	EndMatch();
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSGameConfig& Config = Game->Data().Game;
	BuildMap(InOptions.MapId);
	if (!World.IsValid()) return;

	Options = InOptions;
	Seed = Options.Seed != 0 ? Options.Seed : ((uint32)FDateTime::Now().GetTicks() | 1u);
	Rng = FTSRng(Seed);
	MatchTime = 0.f;
	MvpId = -1;

	FTSMatchSettings Match = Config.Match;
	Match.RoundsToWin = FMath::Max(1, Options.RoundsToWin);
	Match.HalftimeAfterRound = FMath::Max(1, Options.RoundsToWin - 1);
	Match.TeamSize = FMath::Clamp(Options.TeamSize, 1, 5);
	Flow = FTSMatchFlow(Match, Config.Round, Config.Bomb);
	Bomb = FTSBombSystem();
	Bomb.Init(this);
	Plan = FTSTeamPlan();

	CreateRoster(Match.TeamSize);
	ATSPlayerController* PC = LocalController();
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	for (FTSPlayerRecord& P : Players)
	{
		ATSCharacter* C = GetWorld()->SpawnActor<ATSCharacter>(FVector(0.f, 0.f, -10000.f), FRotator::ZeroRotator, Params);
		C->Init(this, &P);
		C->SetActorHiddenInGame(true);
		Characters.Add(P.Id, C);
		if (P.bIsLocal)
		{
			if (PC) PC->Possess(C);
		}
		else
		{
			AController* Bot = GetWorld()->SpawnActor<AController>(ATSBotController::StaticClass(), FTransform::Identity, Params);
			Bot->Possess(C);
			BotControllers.Add(Bot);
			Brains.Add(P.Id, FTSBotBrain(this, C, Game->Data().Difficulty(P.DifficultyId)));
		}
	}
	if (PC) AddTickPrerequisiteActor(PC);
	bRunning = true;
	for (const FTSFlowEvent& E : Flow.Start(Options.PlayerSide)) Handle(E);
}

void ATSGameMode::EndMatch()
{
	bRunning = false;
	if (ATSPlayerController* PC = LocalController())
	{
		PC->UnPossess();
		if (MenuCamera) PC->SetViewTarget(MenuCamera);
	}
	for (auto& Pair : Characters) if (Pair.Value) Pair.Value->Destroy();
	for (AController* C : BotControllers) if (C) C->Destroy();
	Characters.Reset();
	BotControllers.Reset();
	Brains.Reset();
	PreviousInteract.Reset();
	Effects.ClearAll();
	Bomb.Destroy();
	Bomb = FTSBombSystem();
	Players.Reset();
}

void ATSGameMode::CreateRoster(int32 TeamSize)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSGameData& D = Game->Data();
	const FString DefaultSecondary = D.Game.Loadout.DefaultSecondary;
	TArray<FString> Names = D.Bots.Names;
	Rng.Shuffle(Names);
	int32 NameIndex = 0;

	Players.Reset();
	Players.Reserve(TeamSize * 2); // records are referenced by pointer; never reallocate during a match
	FTSPlayerRecord Local;
	Local.Id = 0;
	Local.Name = Options.PlayerName;
	Local.bIsLocal = true;
	Local.Team = ETSTeam::A;
	Local.AgentId = D.Agent(Options.AgentId) ? D.Agent(Options.AgentId)->Id : FString();
	Local.Loadout = FTSLoadout(DefaultSecondary);
	Players.Add(Local);
	LocalId = 0;
	int32 NextId = 1;
	for (ETSTeam Team : { ETSTeam::A, ETSTeam::B })
	{
		TArray<const FTSAgentDef*> Pool;
		for (const FTSAgentDef& A : D.Agents)
			if (Team != ETSTeam::A || A.Id != Local.AgentId) Pool.Add(&A);
		Rng.Shuffle(Pool);
		const int32 Bots = Team == ETSTeam::A ? TeamSize - 1 : TeamSize;
		for (int32 i = 0; i < Bots; ++i)
		{
			FTSPlayerRecord P;
			P.Id = NextId++;
			P.Name = Names.Num() > 0 ? Names[NameIndex++ % Names.Num()] : FString::Printf(TEXT("Bot %d"), P.Id);
			P.bIsBot = true;
			P.Team = Team;
			P.AgentId = Pool.Num() > 0 ? Pool[i % Pool.Num()]->Id : D.Agents[0].Id;
			P.DifficultyId = Options.Difficulty;
			P.Loadout = FTSLoadout(DefaultSecondary);
			Players.Add(P);
		}
	}
}

// ------------------------------------------------------------------------------------- tick

void ATSGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bRunning)
	{
		UpdateMenuCamera(DeltaSeconds);
		return;
	}
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	MatchTime += Dt;
	const bool bFrozen = Flow.MovementFrozen() || Flow.IsMatchOver();
	ATSPlayerController* PC = LocalController();

	// 1. think + 2. act, in roster order (players and bots are treated identically).
	for (FTSPlayerRecord& P : Players)
	{
		ATSCharacter* C = Character(P.Id);
		if (C == nullptr || !C->IsAlive()) continue;
		FTSIntent Intent;
		if (P.bIsLocal) Intent = PC ? PC->BuildIntent(C) : FTSIntent::Idle(C->Yaw, C->Pitch);
		else Intent = Brains.FindChecked(P.Id).Think(Dt);
		C->bFrozen = bFrozen;
		C->bInteractLock = Bomb.IsBusy(C);
		C->TickCharacter(Intent, Dt);
		HandleDropAndSwap(C, Intent);
	}
	// 3. world
	Effects.Tick(Dt);
	Bomb.Tick(Dt);
	// 4. rules
	for (const FTSFlowEvent& E : Flow.Tick(Dt, Snapshot())) Handle(E);

	if (PC) PC->UpdateView(Dt);
	if (PC && PC->GetViewTarget() == MenuCamera.Get()) UpdateMenuCamera(Dt);
}

FTSRoundSnapshot ATSGameMode::Snapshot() const
{
	FTSRoundSnapshot S;
	for (const FTSPlayerRecord& P : Players)
	{
		if (!P.bAlive) continue;
		if (Flow.SideOf(P.Team) == ETSSide::Attack) S.AliveAttackers++;
		else S.AliveDefenders++;
	}
	return S;
}

void ATSGameMode::UpdateMenuCamera(float Dt)
{
	if (MenuCamera == nullptr || !World.IsValid()) return;
	const float Size = FMath::Max(World.Grid.WorldWidth(), World.Grid.WorldHeight()) * 100.f;
	OrbitAngle += Dt * (bRunning ? 8.f : 4.f);
	const float R = Size * (bRunning ? 0.45f : 0.55f);
	const FVector Pos(FMath::Cos(FMath::DegreesToRadians(OrbitAngle)) * R, FMath::Sin(FMath::DegreesToRadians(OrbitAngle)) * R, Size * (bRunning ? 0.7f : 0.45f));
	MenuCamera->SetActorLocationAndRotation(Pos, (-Pos).Rotation());
}

void ATSGameMode::HandleDropAndSwap(ATSCharacter* C, const FTSIntent& Intent)
{
	if (!C->IsAlive()) return;
	const bool bWasInteract = PreviousInteract.FindRef(C->Id());
	PreviousInteract.Add(C->Id(), Intent.bInteract);
	if (Intent.bDrop && !C->bCarryingBomb)
	{
		const ETSWeaponSlot Slot = (ETSWeaponSlot)C->Weapons.CurrentSlot;
		const FTSWeaponInstance& Current = C->Weapons.Current();
		if (Slot != ETSWeaponSlot::Melee && Current.IsValid() && (Slot == ETSWeaponSlot::Primary || Current.Def->Price > 0))
		{
			const FTSWeaponInstance Dropped = C->Weapons.Remove(Slot);
			if (Slot == ETSWeaponSlot::Primary) C->Record->Loadout.PrimaryId.Empty();
			else C->Record->Loadout.SecondaryId.Empty();
			Effects.SpawnPickup(Dropped, C->Feet() + C->GetActorForwardVector() * 120.f);
		}
	}
	const bool bBusyWithBomb = Bomb.IsBusy(C) || (C->bCarryingBomb && World.SiteAt(C->Feet()) >= 0) ||
		(Bomb.State == ETSBombState::Planted && C->Side() == ETSSide::Defense && FVector::DistSquared2D(C->Feet(), Bomb.Position) < FMath::Square(200.0));
	if (Intent.bInteract && !bWasInteract && !bBusyWithBomb) Effects.TrySwap(C);
}

// ------------------------------------------------------------------------------ flow events

void ATSGameMode::Handle(const FTSFlowEvent& E)
{
	switch (E.Type)
	{
	case ETSFlowEventType::RoundStarted:
		StartRound(E.Reset);
		break;
	case ETSFlowEventType::PhaseChanged:
		if (E.Phase == ETSMatchPhase::Live)
		{
			PlaySound2D(TEXT("round_start"));
			Announce(TEXT("GO!"), 1.2f);
		}
		break;
	case ETSFlowEventType::OvertimeStarted:
		Announce(TEXT("OVERTIME"), 3.f);
		break;
	case ETSFlowEventType::BombPlanted:
		PlaySound2D(TEXT("bomb_planted"));
		Announce(FString::Printf(TEXT("BOMB PLANTED AT %s"), *TSIds::SiteName(E.Site)), 2.5f);
		Plan.OnBombPlanted(E.Site);
		break;
	case ETSFlowEventType::BombDefused:
		PlaySound2D(TEXT("bomb_defused"));
		break;
	case ETSFlowEventType::BombDetonated:
		Bomb.Explode();
		break;
	case ETSFlowEventType::RoundEnded:
		OnRoundEnded(E);
		break;
	case ETSFlowEventType::SidesSwapped:
		Announce(TEXT("SWITCHING SIDES"), 3.f);
		break;
	case ETSFlowEventType::MatchEnded:
		OnMatchEnded();
		break;
	}
}

void ATSGameMode::StartRound(ETSEconomyReset Reset)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSGameData& D = Game->Data();
	const FTSEconomySettings& Eco = D.Game.Economy;
	const FString DefaultSecondary = D.Game.Loadout.DefaultSecondary;
	Effects.ClearAll();
	Bomb.Reset();
	for (FTSPlayerRecord& P : Players)
	{
		switch (Reset)
		{
		case ETSEconomyReset::StartMoney:
			P.Money = Eco.StartMoney;
			P.Loadout.Clear(DefaultSecondary);
			break;
		case ETSEconomyReset::OvertimeMoney:
			P.Money = D.Game.Match.OvertimeStartMoney;
			break;
		case ETSEconomyReset::OvertimeMoneyAndClear:
			P.Money = D.Game.Match.OvertimeStartMoney;
			P.Loadout.Clear(DefaultSecondary);
			break;
		default:
			break;
		}
		P.Loadout.Purchases.Reset();
		P.DamageDealt.Reset();
		TSShop::GrantFreeCharges(D.Agent(P.AgentId), P.Loadout);
	}

	for (ETSSide Side : { ETSSide::Attack, ETSSide::Defense })
	{
		TArray<FTSCell> Cells = World.SpawnCells(Side);
		Rng.Shuffle(Cells);
		FVector Centroid = FVector::ZeroVector;
		for (const FTSCell& C : Cells) Centroid += World.CellToWorld(C);
		if (Cells.Num() > 0) Centroid /= (double)Cells.Num();
		const float Yaw = (World.Center() - Centroid).Rotation().Yaw;
		int32 i = 0;
		for (FTSPlayerRecord& P : Players)
		{
			if (Flow.SideOf(P.Team) != Side) continue;
			const FTSCell Cell = Cells.Num() > 0 ? Cells[i++ % Cells.Num()] : FTSCell();
			const float Jitter = World.Grid.CellSize * 25.f;
			const FVector Pos = World.CellToWorld(Cell) + FVector(Rng.Range(-Jitter, Jitter), Rng.Range(-Jitter, Jitter), 5.f);
			Character(P.Id)->Respawn(Pos, Yaw);
		}
	}

	TArray<ATSCharacter*> Attackers = AliveCharacters().FilterByPredicate([](const ATSCharacter* C) { return C->Side() == ETSSide::Attack; });
	if (Attackers.Num() > 0) Bomb.GiveTo(Attackers[Rng.RangeInt(0, Attackers.Num())]);
	Plan.OnRoundStart(this);
	for (auto& Pair : Brains) Pair.Value.OnSpawn();
	if (ATSPlayerController* PC = LocalController())
		if (ATSCharacter* Local = LocalCharacter()) PC->OnSpawn(Local);

	for (FTSPlayerRecord& P : Players)
	{
		if (!P.bIsBot) continue;
		for (const FString& Item : TSBotBuy::Plan(D, D.Agent(P.AgentId), SideOf(P), P.Loadout, P.Money, Rng)) TryBuy(P, Item);
	}
	Announce(Reset == ETSEconomyReset::None ? FString(TEXT("BUY PHASE")) : FString::Printf(TEXT("BUY PHASE - press %s"), *TSKeyNames::Label(Game->Keys.Key(TEXT("BuyMenu")))), 2.5f);
}

void ATSGameMode::OnRoundEnded(const FTSFlowEvent& E)
{
	const FTSGameConfig& G = UTSGameSubsystem::Get(this)->Data().Game;
	for (FTSPlayerRecord& P : Players)
	{
		const bool bWon = P.Team == E.Team;
		const bool bAttacker = Flow.SideOf(P.Team) == ETSSide::Attack;
		const int32 Income = TSEconomy::RoundIncome(G.Economy, bWon, Flow.LossStreak[TSIds::Index(P.Team)], bAttacker, E.bBombPlanted);
		P.Money = TSEconomy::AddMoney(G.Economy, P.Money, Income);
		if (ATSCharacter* C = Character(P.Id))
			if (C->IsAlive()) P.Loadout.Armor = C->Armor;
	}
	const FString Who = E.Side == ETSSide::Attack ? TEXT("ATTACKERS WIN") : TEXT("DEFENDERS WIN");
	FString Why;
	switch (E.Reason)
	{
	case ETSRoundEndReason::BombDetonated: Why = TEXT("The bomb detonated"); break;
	case ETSRoundEndReason::BombDefused: Why = TEXT("The bomb was defused"); break;
	case ETSRoundEndReason::TimeExpired: Why = TEXT("Time ran out"); break;
	default: Why = E.Side == ETSSide::Attack ? TEXT("Defenders eliminated") : TEXT("Attackers eliminated"); break;
	}
	Announce(Who + TEXT("\n") + Why, G.Round.RoundEndSeconds);
	const FTSPlayerRecord* Local = LocalRecord();
	PlaySound2D(Local && E.Team == Local->Team ? TEXT("round_win") : TEXT("round_lose"));
}

void ATSGameMode::OnMatchEnded()
{
	int32 Best = MIN_int32;
	for (const FTSPlayerRecord& P : Players)
		if (P.Score > Best) { Best = P.Score; MvpId = P.Id; }
	if (ATSPlayerController* PC = LocalController()) PC->ShowMatchEnd();
}

// --------------------------------------------------------------------------- combat callbacks

void ATSGameMode::OnCharacterKilled(ATSCharacter* Victim, ATSCharacter* Killer, const FString& SourceId, bool bHeadshot)
{
	const FTSGameData& D = UTSGameSubsystem::Get(this)->Data();
	const FTSGameConfig& G = D.Game;
	FTSPlayerRecord& V = *Victim->Record;
	V.Deaths++;
	V.AddUltPoints(Victim->Agent, G.Ultimate.PointsPerDeath);
	if (Killer != nullptr && Killer != Victim && Killer->Team() != Victim->Team())
	{
		FTSPlayerRecord& K = *Killer->Record;
		K.Kills++;
		K.Score += G.Scoring.Kill;
		K.Money = TSEconomy::AddMoney(G.Economy, K.Money, TSEconomy::KillReward(G.Economy, D.Weapon(SourceId)));
		K.AddUltPoints(Killer->Agent, G.Ultimate.PointsPerKill);
	}
	int32 Assister = -1;
	for (FTSPlayerRecord& P : Players)
	{
		if ((Killer != nullptr && &P == Killer->Record) || P.Team == V.Team) continue;
		const int32* Dealt = P.DamageDealt.Find(V.Id);
		if (Dealt != nullptr && *Dealt >= G.Combat.AssistMinDamage)
		{
			P.Assists++;
			P.Score += G.Scoring.Assist;
			if (Assister < 0) Assister = P.Id;
		}
	}

	const FTSWeaponHandler& W = Victim->Weapons;
	if (W.Slots[0].IsValid()) Effects.SpawnPickup(W.Slots[0], Victim->Feet() + FVector(Rng.Range(-50.f, 50.f), Rng.Range(-50.f, 50.f), 0.f));
	else if (W.Slots[1].IsValid() && W.Slots[1].Def->Price > 0) Effects.SpawnPickup(W.Slots[1], Victim->Feet());
	if (Bomb.Carrier == Victim) Bomb.Drop(Victim->Feet());
	V.Loadout.Clear(G.Loadout.DefaultSecondary);

	FTSKillEvent E;
	E.KillerId = Killer ? Killer->Id() : -1;
	E.VictimId = Victim->Id();
	E.AssisterId = Assister;
	E.SourceId = SourceId;
	const FTSWeaponDef* Weapon = D.Weapon(SourceId);
	const FTSAbilityDef* Ability = D.Ability(SourceId);
	E.SourceName = SourceId == TEXT("bomb") ? FString(TEXT("Bomb")) : Weapon ? Weapon->DisplayName : Ability ? Ability->DisplayName : SourceId;
	E.bHeadshot = bHeadshot;
	OnKill.Broadcast(E);
	if (Victim->Record->bIsLocal)
		if (ATSPlayerController* PC = LocalController()) PC->OnLocalDeath();
}

void ATSGameMode::OnWeaponChanged(ATSCharacter* C, const FTSWeaponDef& Def)
{
	if (Def.GetSlot() == ETSWeaponSlot::Primary) C->Record->Loadout.PrimaryId = Def.Id;
	else if (Def.GetSlot() == ETSWeaponSlot::Secondary) C->Record->Loadout.SecondaryId = Def.Id;
}

// ------------------------------------------------------------------------------------ shop

bool ATSGameMode::CanBuyNow(const FTSPlayerRecord* P) const
{
	if (!bRunning || P == nullptr || !Flow.CanBuy()) return false;
	const ATSCharacter* C = Character(P->Id);
	if (C == nullptr || !C->IsAlive()) return false;
	return !UTSGameSubsystem::Get(this)->Data().Game.Round.BuyOnlyInSpawnZone || World.InSpawnZone(SideOf(*P), C->Feet());
}

ETSShopResult ATSGameMode::TryBuy(FTSPlayerRecord& P, const FString& ItemId)
{
	ETSShopResult Result = ETSShopResult::NotAllowed;
	if (CanBuyNow(&P))
	{
		const FTSGameData& D = UTSGameSubsystem::Get(this)->Data();
		ATSCharacter* C = Character(P.Id);
		const FTSShopOutcome O = TSShop::Buy(D, D.Agent(P.AgentId), SideOf(P), P.Loadout, P.Money, ItemId);
		Result = O.Result;
		if (O.Ok())
		{
			P.Money = O.Money;
			if (const FTSWeaponDef* Def = D.Weapon(ItemId))
			{
				const FTSWeaponInstance Old = C->Weapons.Replace(FTSWeaponInstance(Def));
				if (!O.DroppedWeaponId.IsEmpty() && Old.IsValid()) Effects.SpawnPickup(Old, C->Feet() + C->GetActorForwardVector() * 80.f);
			}
			C->Armor = P.Loadout.Armor;
		}
	}
	if (P.bIsLocal) PlaySound2D(Result == ETSShopResult::Ok ? TEXT("buy") : TEXT("ui_error"));
	return Result;
}

ETSShopResult ATSGameMode::TrySell(FTSPlayerRecord& P, const FString& ItemId)
{
	const FTSGameData& D = UTSGameSubsystem::Get(this)->Data();
	ATSCharacter* C = Character(P.Id);
	if (!bRunning || !Flow.CanSell() || !D.Game.Economy.SellBackDuringBuyPhase || C == nullptr || !C->IsAlive()) return ETSShopResult::NotAllowed;
	const FTSShopOutcome O = TSShop::Sell(D, P.Loadout, P.Money, ItemId);
	if (O.Ok())
	{
		P.Money = O.Money;
		if (const FTSWeaponDef* Def = D.Weapon(ItemId))
		{
			const FString Now = Def->GetSlot() == ETSWeaponSlot::Primary ? P.Loadout.PrimaryId : P.Loadout.SecondaryId;
			if (Now.IsEmpty()) C->Weapons.Remove(Def->GetSlot());
			else C->Weapons.Replace(FTSWeaponInstance(D.Weapon(Now)));
		}
		C->Armor = P.Loadout.Armor;
	}
	if (P.bIsLocal) PlaySound2D(O.Ok() ? TEXT("buy") : TEXT("ui_error"));
	return O.Result;
}

// --------------------------------------------------------------------------------- helpers

ATSCharacter* ATSGameMode::Character(int32 Id) const
{
	const TObjectPtr<ATSCharacter>* Found = Characters.Find(Id);
	return Found ? Found->Get() : nullptr;
}

TArray<ATSCharacter*> ATSGameMode::AllCharacters() const
{
	TArray<ATSCharacter*> Out;
	for (const auto& Pair : Characters) if (Pair.Value) Out.Add(Pair.Value.Get());
	return Out;
}

TArray<ATSCharacter*> ATSGameMode::AliveCharacters() const
{
	TArray<ATSCharacter*> Out;
	for (const auto& Pair : Characters) if (Pair.Value && Pair.Value->IsAlive()) Out.Add(Pair.Value.Get());
	return Out;
}

FTSPlayerRecord* ATSGameMode::Record(int32 Id)
{
	for (FTSPlayerRecord& P : Players) if (P.Id == Id) return &P;
	return nullptr;
}

FTSPlayerRecord* ATSGameMode::LocalRecord()
{
	return Record(LocalId);
}

ATSCharacter* ATSGameMode::LocalCharacter() const
{
	return Character(LocalId);
}

void ATSGameMode::Announce(const FString& Text, float Seconds)
{
	OnAnnounce.Broadcast(Text, Seconds);
}

void ATSGameMode::PlaySound(const FString& CueId, const FVector& Location, float Volume)
{
	if (Audio) Audio->Play(CueId, Location, Volume);
}

void ATSGameMode::PlaySound2D(const FString& CueId, float Volume)
{
	if (Audio) Audio->Play2D(CueId, Volume);
}
