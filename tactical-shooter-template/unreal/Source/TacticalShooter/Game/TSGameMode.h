#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "Core/TSMatchFlow.h"
#include "Core/TSRng.h"
#include "Game/TSBomb.h"
#include "Game/TSBotBrain.h"
#include "Game/TSCombat.h"
#include "Game/TSEffects.h"
#include "Game/TSMapActor.h"
#include "Game/TSTypes.h"
#include "TSGameMode.generated.h"

class ATSCharacter;
class ATSPlayerController;
class ATSAudioHost;
class ACameraActor;
class AController;

/**
 * Runs the game: builds the level from the map data, shows the main menu, and runs a match -
 * creates the roster and characters, drives everything in one explicit tick order
 * (think -> act -> world -> rules), and reacts to FTSMatchFlow events with spawning, economy and
 * announcements. Offline: one human and bots. Mirrors MatchController.cs + GameBootstrap.cs.
 * Networking would put this on the server and replicate FTSIntent from clients.
 */
UCLASS()
class TACTICALSHOOTER_API ATSGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ATSGameMode();
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaSeconds) override;
	/** Characters are spawned by the match, not by the default pawn logic. */
	virtual void RestartPlayer(AController* NewPlayer) override {}

	void StartMatch(const FTSMatchOptions& InOptions);
	/** Leaves the match (pause menu) and returns to the main menu camera. */
	void EndMatch();
	bool IsRunning() const { return bRunning; }

	ATSCharacter* Character(int32 Id) const;
	TArray<ATSCharacter*> AliveCharacters() const;
	TArray<ATSCharacter*> AllCharacters() const;
	FTSPlayerRecord* Record(int32 Id);
	FTSPlayerRecord* LocalRecord();
	ATSCharacter* LocalCharacter() const;
	ETSSide SideOf(const FTSPlayerRecord& P) const { return Flow.SideOf(P.Team); }
	const FTSBotBrain* Brain(int32 Id) const { return Brains.Find(Id); }
	/** Orbiting camera used by the menus and when nobody is left to spectate. */
	ACameraActor* OverviewCamera() const;

	bool CanBuyNow(const FTSPlayerRecord* P) const;
	ETSShopResult TryBuy(FTSPlayerRecord& P, const FString& ItemId);
	ETSShopResult TrySell(FTSPlayerRecord& P, const FString& ItemId);

	/** Where something the character drops lands: up to DistanceCm in front of the feet, short of walls. */
	FVector DropPoint(const ATSCharacter* C, float DistanceCm) const;

	void OnCharacterKilled(ATSCharacter* Victim, ATSCharacter* Killer, const FString& SourceId, bool bHeadshot);
	void OnWeaponChanged(ATSCharacter* C, const FTSWeaponDef& Def);
	void Announce(const FString& Text, float Seconds);
	void PlaySound(const FString& CueId, const FVector& Location, float Volume = 1.f);
	void PlaySound2D(const FString& CueId, float Volume = 1.f);

	FTSMatchFlow Flow;
	FTSMatchOptions Options;
	TArray<FTSPlayerRecord> Players;
	FTSWorldMap World;
	FTSBombSystem Bomb;
	FTSEffectsWorld Effects;
	FTSCombat Combat;
	FTSTeamPlan Plan;
	float MatchTime = 0.f;
	uint32 Seed = 1;
	FTSRng Rng;
	int32 MvpId = -1;
	int32 LocalId = 0;

	FTSOnKill OnKill;
	FTSOnDamage OnDamage;
	FTSOnAnnounce OnAnnounce;

private:
	void BuildMap(const FString& MapId);
	void CreateRoster(int32 TeamSize);
	void HandleDropAndSwap(ATSCharacter* C, const FTSIntent& Intent);
	FTSRoundSnapshot Snapshot() const;
	void Handle(const FTSFlowEvent& E);
	void StartRound(ETSEconomyReset Reset);
	void OnRoundEnded(const FTSFlowEvent& E);
	void OnMatchEnded();
	void UpdateMenuCamera(float Dt);
	ATSPlayerController* LocalController() const;

	bool bRunning = false;
	FString BuiltMapId;
	float OrbitAngle = 0.f;
	TMap<int32, FTSBotBrain> Brains;
	TMap<int32, bool> PreviousInteract;

	UPROPERTY() TMap<int32, TObjectPtr<ATSCharacter>> Characters;
	UPROPERTY() TArray<TObjectPtr<AController>> BotControllers;
	UPROPERTY() TObjectPtr<ATSMapActor> MapActor;
	UPROPERTY() TObjectPtr<ACameraActor> MenuCamera;
	UPROPERTY() TObjectPtr<ATSAudioHost> Audio;
};
