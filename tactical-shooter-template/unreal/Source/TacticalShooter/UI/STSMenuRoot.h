#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Core/TSEnums.h"
#include "Game/TSPlayerController.h"

class SBox;
class UTSGameSubsystem;
class ATSGameMode;
struct FTSPlayerRecord;
struct FTSShopItem;

/**
 * Every menu page, built in Slate from code so the template needs no UMG assets: main menu,
 * match setup, settings (gameplay, video, audio, controls with key rebinding, crosshair), pause,
 * buy menu (left click buys, right click sells back) and match end. Values are bound through
 * attributes and re-read every frame, so a page is only rebuilt when it opens.
 * Mirrors MenuScreens.cs + ScoreScreens.cs in the Unity project.
 */
class TACTICALSHOOTER_API STSMenuRoot : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(STSMenuRoot) : _Owner(nullptr) {}
		SLATE_ARGUMENT(ATSPlayerController*, Owner)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	/** Shows a page (rebuilding it); None hides the whole widget. */
	void SetPage(ETSMenuPage InPage);
	bool IsCapturingKey() const { return !CaptureAction.IsEmpty(); }

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnPreviewKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnPreviewMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;

private:
	TSharedRef<SWidget> BuildMainMenu();
	TSharedRef<SWidget> BuildSetup();
	TSharedRef<SWidget> BuildSettings();
	TSharedRef<SWidget> BuildSettingsTab(int32 Tab);
	TSharedRef<SWidget> BuildControls();
	TSharedRef<SWidget> BuildPause();
	TSharedRef<SWidget> BuildBuy();
	TSharedRef<SWidget> BuildBuyItem(const FTSShopItem& Item);
	TSharedRef<SWidget> BuildMatchEnd();
	TSharedRef<SWidget> BuildScoreTable();

	void SelectTab(int32 Tab);
	void BeginCapture(const FString& Action, bool bAlt);
	/** Stores the captured key name ("" clears an alternative key); unknown keys keep waiting. */
	void FinishCapture(const FString& KeyName);

	FString AgentInfo() const;
	ETSShopResult BuyCheck(const FTSShopItem& Item) const;
	bool CanSellItem(const FTSShopItem& Item) const;
	bool IsOwned(const FTSShopItem& Item) const;
	FString BuyItemTitle(const FTSShopItem& Item) const;
	FString BuyItemPrice(const FTSShopItem& Item) const;
	float BuyTimeLeft() const;

	ATSPlayerController* PC() const { return Owner.Get(); }
	UTSGameSubsystem* Game() const;
	ATSGameMode* Mode() const;
	FTSPlayerRecord* Local() const;

	TWeakObjectPtr<ATSPlayerController> Owner;
	TSharedPtr<SBox> PageBox;
	TSharedPtr<SBox> TabBox;
	ETSMenuPage Page = ETSMenuPage::None;
	int32 SettingsTab = 0;
	FString CaptureAction;
	bool bCaptureAlt = false;
};
