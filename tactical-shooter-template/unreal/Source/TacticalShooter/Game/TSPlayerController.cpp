#include "Game/TSPlayerController.h"
#include "Game/TSCharacter.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"
#include "UI/STSMenuRoot.h"
#include "Camera/CameraActor.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "Framework/Application/SlateApplication.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"

namespace
{
	const TMap<FString, FKey>& KeyTable()
	{
		static TMap<FString, FKey> Table;
		if (Table.Num() > 0) return Table;
		const FKey Letters[] = {
			EKeys::A, EKeys::B, EKeys::C, EKeys::D, EKeys::E, EKeys::F, EKeys::G, EKeys::H, EKeys::I, EKeys::J, EKeys::K, EKeys::L, EKeys::M,
			EKeys::N, EKeys::O, EKeys::P, EKeys::Q, EKeys::R, EKeys::S, EKeys::T, EKeys::U, EKeys::V, EKeys::W, EKeys::X, EKeys::Y, EKeys::Z };
		for (int32 i = 0; i < 26; ++i) Table.Add(FString::Chr(TEXT('A') + i), Letters[i]);
		const FKey Digits[] = { EKeys::Zero, EKeys::One, EKeys::Two, EKeys::Three, EKeys::Four, EKeys::Five, EKeys::Six, EKeys::Seven, EKeys::Eight, EKeys::Nine };
		for (int32 i = 0; i < 10; ++i) Table.Add(FString::FromInt(i), Digits[i]);
		const FKey Functions[] = { EKeys::F1, EKeys::F2, EKeys::F3, EKeys::F4, EKeys::F5, EKeys::F6, EKeys::F7, EKeys::F8, EKeys::F9, EKeys::F10, EKeys::F11, EKeys::F12 };
		for (int32 i = 0; i < 12; ++i) Table.Add(FString::Printf(TEXT("F%d"), i + 1), Functions[i]);
		Table.Add(TEXT("Space"), EKeys::SpaceBar);
		Table.Add(TEXT("Enter"), EKeys::Enter);
		Table.Add(TEXT("Escape"), EKeys::Escape);
		Table.Add(TEXT("Tab"), EKeys::Tab);
		Table.Add(TEXT("Backspace"), EKeys::BackSpace);
		Table.Add(TEXT("LeftShift"), EKeys::LeftShift);
		Table.Add(TEXT("RightShift"), EKeys::RightShift);
		Table.Add(TEXT("LeftCtrl"), EKeys::LeftControl);
		Table.Add(TEXT("RightCtrl"), EKeys::RightControl);
		Table.Add(TEXT("LeftAlt"), EKeys::LeftAlt);
		Table.Add(TEXT("RightAlt"), EKeys::RightAlt);
		Table.Add(TEXT("Up"), EKeys::Up);
		Table.Add(TEXT("Down"), EKeys::Down);
		Table.Add(TEXT("Left"), EKeys::Left);
		Table.Add(TEXT("Right"), EKeys::Right);
		Table.Add(TEXT("Mouse1"), EKeys::LeftMouseButton);
		Table.Add(TEXT("Mouse2"), EKeys::RightMouseButton);
		Table.Add(TEXT("Mouse3"), EKeys::MiddleMouseButton);
		Table.Add(TEXT("Mouse4"), EKeys::ThumbMouseButton);
		Table.Add(TEXT("Mouse5"), EKeys::ThumbMouseButton2);
		Table.Add(TEXT("WheelUp"), EKeys::MouseScrollUp);
		Table.Add(TEXT("WheelDown"), EKeys::MouseScrollDown);
		Table.Add(TEXT("CapsLock"), EKeys::CapsLock);
		Table.Add(TEXT("Backquote"), EKeys::Tilde);
		Table.Add(TEXT("Minus"), EKeys::Hyphen);
		Table.Add(TEXT("Equals"), EKeys::Equals);
		Table.Add(TEXT("Comma"), EKeys::Comma);
		Table.Add(TEXT("Period"), EKeys::Period);
		Table.Add(TEXT("Slash"), EKeys::Slash);
		Table.Add(TEXT("Semicolon"), EKeys::Semicolon);
		Table.Add(TEXT("Quote"), EKeys::Apostrophe);
		Table.Add(TEXT("LeftBracket"), EKeys::LeftBracket);
		Table.Add(TEXT("RightBracket"), EKeys::RightBracket);
		Table.Add(TEXT("Backslash"), EKeys::Backslash);
		Table.Add(TEXT("Insert"), EKeys::Insert);
		Table.Add(TEXT("Delete"), EKeys::Delete);
		Table.Add(TEXT("Home"), EKeys::Home);
		Table.Add(TEXT("End"), EKeys::End);
		Table.Add(TEXT("PageUp"), EKeys::PageUp);
		Table.Add(TEXT("PageDown"), EKeys::PageDown);
		return Table;
	}

	/** Mouse counts -> degrees at sensitivity 1 (same constant as the Unity project). */
	constexpr float MouseCountsToDegrees = 0.07f;
}

ATSPlayerController::ATSPlayerController()
{
	PrimaryActorTick.bTickEvenWhenPaused = true;
	bShowMouseCursor = false;
}

void ATSPlayerController::BeginPlay()
{
	Super::BeginPlay();
	if (IsLocalController()) ShowMainMenu();
}

void ATSPlayerController::EndPlay(const EEndPlayReason::Type Reason)
{
	if (Menu.IsValid())
	{
		if (UGameViewportClient* Viewport = GetWorld() ? GetWorld()->GetGameViewport() : nullptr)
			Viewport->RemoveViewportWidgetContent(Menu.ToSharedRef());
		Menu.Reset();
	}
	Super::EndPlay(Reason);
}

ATSGameMode* ATSPlayerController::Mode() const
{
	return GetWorld() ? GetWorld()->GetAuthGameMode<ATSGameMode>() : nullptr;
}

// ------------------------------------------------------------------------------------ keys

FKey ATSPlayerController::ToKey(const FString& Name)
{
	const FKey* Found = KeyTable().Find(Name);
	return Found ? *Found : EKeys::Invalid;
}

FString ATSPlayerController::FromKey(const FKey& Key)
{
	for (const TPair<FString, FKey>& Pair : KeyTable())
		if (Pair.Value == Key) return Pair.Key;
	return FString();
}

bool ATSPlayerController::KeyDown(const FString& Name) const
{
	const FKey Key = ToKey(Name);
	return Key.IsValid() && IsInputKeyDown(Key);
}

bool ATSPlayerController::KeyPressed(const FString& Name) const
{
	const FKey Key = ToKey(Name);
	return Key.IsValid() && WasInputKeyJustPressed(Key);
}

bool ATSPlayerController::ActionDown(const FString& Action) const
{
	const UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	return Game && (KeyDown(Game->Keys.Key(Action)) || KeyDown(Game->Keys.AltKey(Action)));
}

bool ATSPlayerController::ActionPressed(const FString& Action) const
{
	const UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	return Game && (KeyPressed(Game->Keys.Key(Action)) || KeyPressed(Game->Keys.AltKey(Action)));
}

// ----------------------------------------------------------------------------------- input

bool ATSPlayerController::GameplayInputAllowed() const
{
	const ATSGameMode* M = Mode();
	return CurrentPage == ETSMenuPage::None && M != nullptr && M->IsRunning() && !IsPaused();
}

void ATSPlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);
	ATSGameMode* M = Mode();
	if (M == nullptr || !M->IsRunning() || CurrentPage != ETSMenuPage::None)
	{
		bScoreboardHeld = false;
		if (CurrentPage == ETSMenuPage::Buy && M != nullptr && !M->CanBuyNow(M->LocalRecord())) ShowPage(ETSMenuPage::None);
		return;
	}
	if (ActionPressed(TEXT("Pause")))
	{
		SetPaused(true);
		return;
	}
	if (ActionPressed(TEXT("BuyMenu"))) ToggleBuy();
	bScoreboardHeld = ActionDown(TEXT("Scoreboard"));

	// Mouse look is accumulated here, every frame, and handed over in BuildIntent.
	ATSCharacter* Local = M->LocalCharacter();
	if (Local != nullptr && Local->IsAlive())
	{
		const UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
		float Dx = 0.f, Dy = 0.f;
		GetInputMouseDelta(Dx, Dy);
		float Scale = Game->Settings.MouseSensitivity * MouseCountsToDegrees;
		const FTSWeaponDef* W = Local->Weapons.CurrentDef();
		if (Local->Weapons.bAiming && W != nullptr) Scale *= Game->Settings.AdsSensitivityMultiplier * W->AdsFovMultiplier;
		Yaw = FMath::Fmod(Yaw + Dx * Scale + 360.f, 360.f);
		Pitch = FMath::Clamp(Pitch + Dy * Scale * (Game->Settings.InvertY ? -1.f : 1.f), -89.f, 89.f);
	}
}

FTSIntent ATSPlayerController::BuildIntent(ATSCharacter* C)
{
	FTSIntent I = FTSIntent::Idle(Yaw, Pitch);
	if (!GameplayInputAllowed()) return I;
	const float Now = Mode()->MatchTime;
	I.MoveForward = (ActionDown(TEXT("MoveForward")) ? 1.f : 0.f) - (ActionDown(TEXT("MoveBack")) ? 1.f : 0.f);
	I.MoveRight = (ActionDown(TEXT("MoveRight")) ? 1.f : 0.f) - (ActionDown(TEXT("MoveLeft")) ? 1.f : 0.f);
	if (ActionPressed(TEXT("Jump"))) JumpBufferedUntil = Now + 0.12f;
	I.bJump = Now <= JumpBufferedUntil;
	if (I.bJump && C->IsGrounded()) JumpBufferedUntil = -1.f;
	I.bCrouch = ActionDown(TEXT("Crouch"));
	I.bWalk = ActionDown(TEXT("Walk"));
	I.bFire = ActionDown(TEXT("Fire"));
	I.bAim = ActionDown(TEXT("Aim"));
	I.bReload = ActionPressed(TEXT("Reload"));
	I.bInteract = ActionDown(TEXT("Interact"));
	I.bDrop = ActionPressed(TEXT("Drop"));
	if (ActionPressed(TEXT("Primary"))) I.SelectSlot = 0;
	else if (ActionPressed(TEXT("Secondary"))) I.SelectSlot = 1;
	else if (ActionPressed(TEXT("Melee"))) I.SelectSlot = 2;
	else if (WasInputKeyJustPressed(EKeys::MouseScrollUp) || WasInputKeyJustPressed(EKeys::MouseScrollDown))
	{
		const int32 Step = WasInputKeyJustPressed(EKeys::MouseScrollDown) ? 1 : 2;
		for (int32 k = 1; k <= 3; ++k)
		{
			const int32 S = (C->Weapons.CurrentSlot + Step * k) % 3;
			if (C->Weapons.Slots[S].IsValid()) { I.SelectSlot = S; break; }
		}
	}
	if (ActionPressed(TEXT("Ability1"))) I.UseAbility = 0;
	else if (ActionPressed(TEXT("Ability2"))) I.UseAbility = 1;
	else if (ActionPressed(TEXT("Ability3"))) I.UseAbility = 2;
	else if (ActionPressed(TEXT("Ultimate"))) I.UseAbility = 3;
	return I;
}

void ATSPlayerController::OnSpawn(ATSCharacter* C)
{
	Yaw = C->Yaw;
	Pitch = 0.f;
	DeathTime = -99.f;
	Viewed = C;
	SetViewTarget(C);
}

void ATSPlayerController::OnLocalDeath()
{
	if (const ATSGameMode* M = Mode()) DeathTime = M->MatchTime;
}

// ---------------------------------------------------------------------------------- camera

ATSCharacter* ATSPlayerController::NextTeammate(ATSCharacter* After) const
{
	ATSGameMode* M = Mode();
	const FTSPlayerRecord* Local = M ? M->LocalRecord() : nullptr;
	if (Local == nullptr) return nullptr;
	ATSCharacter* First = nullptr;
	bool bPassed = After == nullptr;
	for (const FTSPlayerRecord& P : M->Players)
	{
		ATSCharacter* C = M->Character(P.Id);
		if (C == nullptr || !C->IsAlive() || P.Team != Local->Team || P.bIsLocal) continue;
		if (First == nullptr) First = C;
		if (bPassed) return C;
		if (C == After) bPassed = true;
	}
	return First;
}

void ATSPlayerController::UpdateView(float Dt)
{
	ATSGameMode* M = Mode();
	if (M == nullptr) return;
	ATSCharacter* Local = M->LocalCharacter();
	ATSCharacter* Target = Viewed.Get();
	if (Local != nullptr && Local->IsAlive())
	{
		Target = Local;
	}
	else if (!(M->MatchTime - DeathTime < 1.5f && Target == Local))
	{
		const bool bNext = GameplayInputAllowed() && ActionPressed(TEXT("Fire"));
		if (Target == nullptr || !Target->IsAlive() || Target == Local || bNext) Target = NextTeammate(Target);
	}
	if (Target == nullptr)
	{
		Viewed = nullptr;
		if (GetViewTarget() != M->OverviewCamera()) SetViewTarget(M->OverviewCamera());
		return;
	}
	Viewed = Target;
	if (GetViewTarget() != Target) SetViewTarget(Target);
	Target->UpdateCamera(Dt, true);
}

// ----------------------------------------------------------------------------------- menus

void ATSPlayerController::ShowPage(ETSMenuPage InPage)
{
	CurrentPage = InPage;
	if (!Menu.IsValid())
	{
		UGameViewportClient* Viewport = GetWorld() ? GetWorld()->GetGameViewport() : nullptr;
		if (Viewport == nullptr) return;
		SAssignNew(Menu, STSMenuRoot).Owner(this);
		Viewport->AddViewportWidgetContent(Menu.ToSharedRef(), 10);
	}
	Menu->SetPage(InPage);
	if (InPage == ETSMenuPage::None)
	{
		SetInputMode(FInputModeGameOnly());
		bShowMouseCursor = false;
	}
	else
	{
		FInputModeUIOnly InputMode;
		InputMode.SetWidgetToFocus(Menu);
		InputMode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		SetInputMode(InputMode);
		bShowMouseCursor = true;
		if (FSlateApplication::IsInitialized()) FSlateApplication::Get().SetKeyboardFocus(Menu);
	}
}

void ATSPlayerController::ShowMainMenu()
{
	if (ATSGameMode* M = Mode())
		if (M->OverviewCamera() != nullptr) SetViewTarget(M->OverviewCamera());
	ShowPage(ETSMenuPage::MainMenu);
}

void ATSPlayerController::ShowMatchEnd()
{
	UGameplayStatics::SetGamePaused(this, false);
	ShowPage(ETSMenuPage::MatchEnd);
}

void ATSPlayerController::SetPaused(bool bPaused)
{
	UGameplayStatics::SetGamePaused(this, bPaused);
	ShowPage(bPaused ? ETSMenuPage::Pause : ETSMenuPage::None);
}

void ATSPlayerController::ToggleBuy()
{
	ATSGameMode* M = Mode();
	if (M == nullptr) return;
	if (CurrentPage == ETSMenuPage::Buy)
	{
		ShowPage(ETSMenuPage::None);
		return;
	}
	if (M->CanBuyNow(M->LocalRecord()))
	{
		ShowPage(ETSMenuPage::Buy);
		return;
	}
	M->PlaySound2D(TEXT("ui_error"));
	M->Announce(M->Flow.CanBuy() ? TEXT("Buy only in your spawn zone") : TEXT("The buy phase is over"), 1.5f);
}

void ATSPlayerController::OpenSettings(bool bFromPause)
{
	bSettingsFromPause = bFromPause;
	ShowPage(ETSMenuPage::Settings);
}

void ATSPlayerController::CloseSettings()
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	Game->ApplySettings();
	Game->SaveSettings();
	const ATSGameMode* M = Mode();
	ShowPage(bSettingsFromPause && M != nullptr && M->IsRunning() ? ETSMenuPage::Pause : ETSMenuPage::MainMenu);
}

void ATSPlayerController::StartMatchFromSettings()
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	Game->SaveSettings();
	UGameplayStatics::SetGamePaused(this, false);
	ShowPage(ETSMenuPage::None);
	if (ATSGameMode* M = Mode()) M->StartMatch(FTSMatchOptions::FromSettings(Game->Settings));
}

void ATSPlayerController::LeaveMatch()
{
	UGameplayStatics::SetGamePaused(this, false);
	if (ATSGameMode* M = Mode()) M->EndMatch();
	ShowMainMenu();
}

void ATSPlayerController::QuitGame()
{
	UTSGameSubsystem::Get(this)->SaveSettings();
	UKismetSystemLibrary::QuitGame(this, this, EQuitPreference::Quit, false);
}

// ------------------------------------------------------------------------------ bot controller

ATSBotController::ATSBotController()
{
	bWantsPlayerState = false;
}
