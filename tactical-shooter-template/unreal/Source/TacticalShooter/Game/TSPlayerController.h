#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Controller.h"
#include "GameFramework/PlayerController.h"
#include "Core/TSIntent.h"
#include "TSPlayerController.generated.h"

class ATSCharacter;
class ATSGameMode;
class STSMenuRoot;

/** Which Slate page is open. None = playing (HUD only). */
enum class ETSMenuPage : uint8 { None, MainMenu, Setup, Settings, Pause, Buy, MatchEnd };

/**
 * Turns the keyboard and mouse into an FTSIntent for the local character (keys are read by
 * their engine-neutral names from input.json), decides what the camera looks through (own eyes,
 * a teammate while dead, the overview camera), and owns the Slate menus. Mirrors
 * PlayerController.cs + UIManager.cs.
 */
UCLASS()
class TACTICALSHOOTER_API ATSPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	ATSPlayerController();
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void PlayerTick(float DeltaTime) override;

	FTSIntent BuildIntent(ATSCharacter* C);
	void OnSpawn(ATSCharacter* C);
	void OnLocalDeath();
	/** Picks the camera: own eyes, a teammate (spectating) or the overview. */
	void UpdateView(float Dt);
	ATSCharacter* ViewedCharacter() const { return Viewed.Get(); }

	// Engine-neutral key names (shared/config/input.json) -> FKey.
	static FKey ToKey(const FString& Name);
	static FString FromKey(const FKey& Key);
	bool KeyDown(const FString& Name) const;
	bool KeyPressed(const FString& Name) const;
	bool ActionDown(const FString& Action) const;
	bool ActionPressed(const FString& Action) const;

	// Menus
	void ShowMainMenu();
	void ShowPage(ETSMenuPage InPage);
	void ShowMatchEnd();
	void SetPaused(bool bPaused);
	void ToggleBuy();
	void OpenSettings(bool bFromPause);
	void CloseSettings();
	void StartMatchFromSettings();
	void LeaveMatch();
	void QuitGame();
	ETSMenuPage Page() const { return CurrentPage; }
	bool GameplayInputAllowed() const;
	bool IsScoreboardHeld() const { return bScoreboardHeld; }
	ATSGameMode* Mode() const;

private:
	ATSCharacter* NextTeammate(ATSCharacter* After) const;

	TSharedPtr<STSMenuRoot> Menu;
	ETSMenuPage CurrentPage = ETSMenuPage::None;
	bool bSettingsFromPause = false;
	bool bScoreboardHeld = false;
	float Yaw = 0.f;
	float Pitch = 0.f;
	float DeathTime = -99.f;
	float JumpBufferedUntil = -1.f;
	TWeakObjectPtr<ATSCharacter> Viewed;
};

/** Minimal controller that possesses bots so CharacterMovement runs; FTSBotBrain does the thinking. */
UCLASS()
class TACTICALSHOOTER_API ATSBotController : public AController
{
	GENERATED_BODY()

public:
	ATSBotController();
};
