#include "UI/STSMenuRoot.h"
#include "Core/TSKeyNames.h"
#include "Core/TSRules.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"
#include "Game/TSTypes.h"
#include "Brushes/SlateColorBrush.h"
#include "Engine/Engine.h"
#include "GameFramework/GameUserSettings.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Styling/SlateTypes.h"
#include "Styling/StyleDefaults.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SSlider.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/SNullWidget.h"
#include "Widgets/Text/STextBlock.h"

// Sizes are in 1080p reference pixels (Slate's default DPI curve scales them with the viewport)
// and font sizes are the pixel sizes used by the Unity UI, converted to Slate points.

namespace
{
	/** sRGB bytes -> the linear colour Slate expects, so the palette matches UIFactory.cs. */
	FLinearColor Rgb(uint8 R, uint8 G, uint8 B, float A = 1.f)
	{
		FLinearColor C = FLinearColor::FromSRGBColor(FColor(R, G, B, 255));
		C.A = A;
		return C;
	}

	FLinearColor PanelColor() { return Rgb(13, 18, 23, 0.92f); }
	FLinearColor PanelLight() { return Rgb(28, 36, 43, 0.95f); }
	FLinearColor Accent() { return Rgb(255, 71, 87); }
	FLinearColor TextColor() { return Rgb(240, 242, 247); }
	FLinearColor TextDim() { return Rgb(158, 171, 184); }
	FLinearColor ButtonColor() { return Rgb(51, 61, 74); }
	FLinearColor Good() { return Rgb(89, 217, 140); }
	FLinearColor Warn() { return Rgb(255, 204, 77); }
	FLinearColor OwnedColor() { return Rgb(64, 115, 89); }
	FLinearColor Dimmer(float Alpha) { return FLinearColor(0.f, 0.f, 0.f, Alpha); }

	const FSlateBrush* WhiteBrush()
	{
		static const FSlateColorBrush Brush(FLinearColor::White);
		return &Brush;
	}

	/** Flat button: the brush is white and SButton::ButtonColorAndOpacity gives the colour. */
	const FButtonStyle& FlatButton()
	{
		static const FButtonStyle Style = []
		{
			FButtonStyle S;
			S.SetNormal(FSlateColorBrush(FLinearColor(1.f, 1.f, 1.f, 1.f)));
			S.SetHovered(FSlateColorBrush(FLinearColor(1.45f, 1.45f, 1.45f, 1.f)));
			S.SetPressed(FSlateColorBrush(FLinearColor(0.7f, 0.7f, 0.7f, 1.f)));
			S.SetDisabled(FSlateColorBrush(FLinearColor(0.55f, 0.55f, 0.55f, 0.55f)));
			S.SetNormalPadding(FMargin(10.f, 4.f));
			S.SetPressedPadding(FMargin(10.f, 5.f, 10.f, 3.f));
			return S;
		}();
		return Style;
	}

	FSlateFontInfo Font(float Px, bool bBold = false)
	{
		// Slate font sizes are points at 96 DPI: 1 pt = 4/3 px.
		return FCoreStyle::GetDefaultFontStyle(bBold ? TEXT("Bold") : TEXT("Regular"), FMath::Max(6, FMath::RoundToInt(Px * 0.75f)));
	}

	TSharedRef<STextBlock> Label(const FString& Text, float Px, const FLinearColor& Color, bool bBold = false,
		ETextJustify::Type Justify = ETextJustify::Left)
	{
		return SNew(STextBlock)
			.Text(FText::FromString(Text))
			.Font(Font(Px, bBold))
			.ColorAndOpacity(Color)
			.Justification(Justify)
			.AutoWrapText(true);
	}

	TSharedRef<STextBlock> DynamicLabel(TFunction<FString()> Get, float Px, const FLinearColor& Color, bool bBold = false,
		ETextJustify::Type Justify = ETextJustify::Left)
	{
		return SNew(STextBlock)
			.Text_Lambda([Get]() { return FText::FromString(Get()); })
			.Font(Font(Px, bBold))
			.ColorAndOpacity(Color)
			.Justification(Justify)
			.AutoWrapText(true);
	}

	TSharedRef<SButton> Button(TSharedRef<SWidget> Content, TFunction<void()> OnClick, TAttribute<FSlateColor> Color)
	{
		return SNew(SButton)
			.ButtonStyle(&FlatButton())
			.ButtonColorAndOpacity(Color)
			.HAlign(HAlign_Center)
			.VAlign(VAlign_Center)
			.OnClicked_Lambda([OnClick]()
			{
				if (OnClick) OnClick();
				return FReply::Handled();
			})
			[
				Content
			];
	}

	TSharedRef<SButton> TextButton(TAttribute<FText> Text, TFunction<void()> OnClick, float Px, TAttribute<FSlateColor> Color)
	{
		return Button(SNew(STextBlock).Text(Text).Font(Font(Px, true)).ColorAndOpacity(TextColor()).Justification(ETextJustify::Center),
			OnClick, Color);
	}

	TSharedRef<SWidget> Sized(TSharedRef<SWidget> Content, float Width, float Height)
	{
		TSharedRef<SBox> Box = SNew(SBox)[Content];
		if (Width > 0.f) Box->SetWidthOverride(Width);
		if (Height > 0.f) Box->SetHeightOverride(Height);
		return Box;
	}

	TSharedRef<SWidget> MenuButton(const FString& Text, TFunction<void()> OnClick, float Px, const FLinearColor& Color, float Width, float Height)
	{
		return Sized(TextButton(FText::FromString(Text), OnClick, Px, Color), Width, Height);
	}

	/** A row of buttons of which one is selected (UIFactory.Options). */
	TSharedRef<SWidget> Options(const TArray<FString>& Labels, TFunction<int32()> Selected, TFunction<void(int32)> Select,
		float Width, float Px = 20.f, float Height = 46.f)
	{
		TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
		for (int32 i = 0; i < Labels.Num(); ++i)
		{
			Row->AddSlot()
				.AutoWidth()
				.Padding(FMargin(0.f, 0.f, 8.f, 0.f))
				[
					Sized(TextButton(FText::FromString(Labels[i]), [Select, i]() { Select(i); }, Px,
						TAttribute<FSlateColor>::CreateLambda([Selected, i]() { return FSlateColor(Selected() == i ? Accent() : ButtonColor()); })),
						Width, Height)
				];
		}
		return Row;
	}

	TSharedRef<SWidget> LabeledRow(const FString& Caption, TSharedRef<SWidget> Content, float Height = 52.f)
	{
		return SNew(SBox)
			.HeightOverride(Height)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				[
					Sized(Label(Caption, 22.f, TextDim()), 400.f, -1.f)
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.f)
				.VAlign(VAlign_Center)
				[
					Content
				]
			];
	}

	enum class EValueFormat : uint8 { Decimals, Whole, Percent };

	FString FormatValue(float V, EValueFormat Format)
	{
		switch (Format)
		{
		case EValueFormat::Whole: return FString::FromInt(FMath::RoundToInt(V));
		case EValueFormat::Percent: return FString::Printf(TEXT("%d%%"), FMath::RoundToInt(V * 100.f));
		default: return FString::Printf(TEXT("%.2f"), V);
		}
	}

	TSharedRef<SWidget> SliderRow(const FString& Caption, float Min, float Max, TFunction<float()> Get, TFunction<void(float)> Set,
		EValueFormat Format)
	{
		const bool bWhole = Format == EValueFormat::Whole;
		return LabeledRow(Caption,
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			[
				Sized(SNew(SSlider)
					.MinValue(Min)
					.MaxValue(Max)
					.StepSize(bWhole ? 1.f : 0.01f)
					.MouseUsesStep(bWhole)
					.Value_Lambda([Get]() { return Get(); })
					.OnValueChanged_Lambda([Set, bWhole](float V) { Set(bWhole ? FMath::RoundToFloat(V) : V); })
					.SliderBarColor(ButtonColor())
					.SliderHandleColor(Accent()),
					560.f, 40.f)
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(FMargin(16.f, 0.f, 0.f, 0.f))
			[
				Sized(DynamicLabel([Get, Format]() { return FormatValue(Get(), Format); }, 22.f, TextColor(), false, ETextJustify::Right), 110.f, -1.f)
			],
			50.f);
	}

	TSharedRef<SWidget> ToggleRow(const FString& Caption, TFunction<bool()> Get, TFunction<void(bool)> Set)
	{
		return LabeledRow(Caption,
			Options({ TEXT("OFF"), TEXT("ON") }, [Get]() { return Get() ? 1 : 0; }, [Set](int32 i) { Set(i == 1); }, 110.f, 18.f, 40.f),
			48.f);
	}

	/** Full-screen dimmer with a centred panel. */
	TSharedRef<SWidget> CentredPanel(TSharedRef<SWidget> Content, float Width, float Height, float DimAlpha, float Padding = 36.f)
	{
		return SNew(SBorder)
			.BorderImage(WhiteBrush())
			.BorderBackgroundColor(Dimmer(DimAlpha))
			.Padding(0.f)
			.HAlign(HAlign_Center)
			.VAlign(VAlign_Center)
			[
				SNew(SBox)
				.WidthOverride(Width)
				.HeightOverride(Height)
				[
					SNew(SBorder)
					.BorderImage(WhiteBrush())
					.BorderBackgroundColor(PanelColor())
					.Padding(Padding)
					[
						Content
					]
				]
			];
	}

	/** Crosshair preview for the settings page; draws the same shape as ATSHUD::DrawCrosshair. */
	class STSCrosshairPreview : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(STSCrosshairPreview) {}
			SLATE_ARGUMENT(TWeakObjectPtr<UTSGameSubsystem>, Game)
		SLATE_END_ARGS()

		void Construct(const FArguments& InArgs) { Game = InArgs._Game; }

		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(120.f, 120.f); }

		virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& Geometry, const FSlateRect& CullingRect,
			FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& WidgetStyle, bool bParentEnabled) const override
		{
			const FVector2D Size = Geometry.GetLocalSize();
			Box(OutDrawElements, LayerId, Geometry, 0.f, 0.f, Size.X, Size.Y, Rgb(77, 87, 97));
			const UTSGameSubsystem* G = Game.Get();
			if (G == nullptr) return LayerId + 1;
			const FTSUserSettings& S = G->Settings;
			const FLinearColor C = UTSGameSubsystem::Color(S.CrosshairColor);
			const float CX = Size.X / 2.f, CY = Size.Y / 2.f;
			const float Len = S.CrosshairSize, T = S.CrosshairThickness, Gap = S.CrosshairGap;
			const int32 Layer = LayerId + 1;
			Box(OutDrawElements, Layer, Geometry, CX - T / 2.f, CY - Gap - Len, T, Len, C);
			Box(OutDrawElements, Layer, Geometry, CX - T / 2.f, CY + Gap, T, Len, C);
			Box(OutDrawElements, Layer, Geometry, CX - Gap - Len, CY - T / 2.f, Len, T, C);
			Box(OutDrawElements, Layer, Geometry, CX + Gap, CY - T / 2.f, Len, T, C);
			if (S.CrosshairDot) Box(OutDrawElements, Layer, Geometry, CX - T / 2.f, CY - T / 2.f, T, T, C);
			return Layer;
		}

	private:
		static void Box(FSlateWindowElementList& Out, int32 Layer, const FGeometry& Geometry, float X, float Y, float W, float H, const FLinearColor& Color)
		{
			FSlateDrawElement::MakeBox(Out, Layer, Geometry.ToPaintGeometry(FVector2D(W, H), FSlateLayoutTransform(FVector2D(X, Y))),
				WhiteBrush(), ESlateDrawEffect::None, Color);
		}

		TWeakObjectPtr<UTSGameSubsystem> Game;
	};

	const TCHAR* const SettingsTabs[] = { TEXT("GAMEPLAY"), TEXT("VIDEO"), TEXT("AUDIO"), TEXT("CONTROLS"), TEXT("CROSSHAIR") };
	const TCHAR* const CrosshairColors[] = { TEXT("#00FF7F"), TEXT("#00E5FF"), TEXT("#FFFFFF"), TEXT("#FFE600"), TEXT("#FF3B30"), TEXT("#FF4DFF") };
	const int32 MatchLengths[] = { 13, 5, 3 };
}

// ------------------------------------------------------------------------------------ core

void STSMenuRoot::Construct(const FArguments& InArgs)
{
	Owner = InArgs._Owner;
	ChildSlot
	[
		SAssignNew(PageBox, SBox)
	];
	SetVisibility(EVisibility::Collapsed);
}

UTSGameSubsystem* STSMenuRoot::Game() const
{
	return UTSGameSubsystem::Get(Owner.Get());
}

ATSGameMode* STSMenuRoot::Mode() const
{
	const ATSPlayerController* P = Owner.Get();
	return P ? P->Mode() : nullptr;
}

FTSPlayerRecord* STSMenuRoot::Local() const
{
	ATSGameMode* M = Mode();
	return M ? M->LocalRecord() : nullptr;
}

void STSMenuRoot::SetPage(ETSMenuPage InPage)
{
	Page = InPage;
	CaptureAction.Empty();
	TSharedRef<SWidget> Content = SNullWidget::NullWidget;
	if (Game() != nullptr)
	{
		switch (Page)
		{
		case ETSMenuPage::MainMenu: Content = BuildMainMenu(); break;
		case ETSMenuPage::Setup: Content = BuildSetup(); break;
		case ETSMenuPage::Settings: Content = BuildSettings(); break;
		case ETSMenuPage::Pause: Content = BuildPause(); break;
		case ETSMenuPage::Buy: Content = BuildBuy(); break;
		case ETSMenuPage::MatchEnd: Content = BuildMatchEnd(); break;
		default: break;
		}
	}
	PageBox->SetContent(Content);
	SetVisibility(Page == ETSMenuPage::None ? EVisibility::Collapsed : EVisibility::Visible);
}

// ---------------------------------------------------------------------------------- input

FReply STSMenuRoot::OnPreviewKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (CaptureAction.IsEmpty()) return FReply::Unhandled();
	FinishCapture(ATSPlayerController::FromKey(InKeyEvent.GetKey()));
	return FReply::Handled();
}

FReply STSMenuRoot::OnPreviewMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (CaptureAction.IsEmpty()) return FReply::Unhandled();
	FinishCapture(ATSPlayerController::FromKey(MouseEvent.GetEffectingButton()));
	return FReply::Handled();
}

FReply STSMenuRoot::OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (CaptureAction.IsEmpty() || MouseEvent.GetWheelDelta() == 0.f) return FReply::Unhandled();
	FinishCapture(MouseEvent.GetWheelDelta() > 0.f ? TEXT("WheelUp") : TEXT("WheelDown"));
	return FReply::Handled();
}

FReply STSMenuRoot::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	// Clicks on empty space keep the keyboard focus on the menu (so Esc and the rebinding work).
	return FReply::Handled().SetUserFocus(SharedThis(this), EFocusCause::Mouse);
}

FReply STSMenuRoot::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	ATSPlayerController* P = PC();
	UTSGameSubsystem* G = Game();
	if (P == nullptr || G == nullptr) return FReply::Unhandled();
	const FString Name = ATSPlayerController::FromKey(InKeyEvent.GetKey());
	auto IsAction = [G, &Name](const TCHAR* Action)
	{
		return !Name.IsEmpty() && (Name == G->Keys.Key(Action) || Name == G->Keys.AltKey(Action));
	};
	// Escape always works as "back"; in the editor it also stops PIE, so the Pause alternative key (P) is handy.
	const bool bBack = InKeyEvent.GetKey() == EKeys::Escape || IsAction(TEXT("Pause"));
	switch (Page)
	{
	case ETSMenuPage::Setup:
		if (bBack) { P->ShowPage(ETSMenuPage::MainMenu); return FReply::Handled(); }
		break;
	case ETSMenuPage::Settings:
		if (bBack) { P->CloseSettings(); return FReply::Handled(); }
		break;
	case ETSMenuPage::Pause:
		if (bBack) { P->SetPaused(false); return FReply::Handled(); }
		break;
	case ETSMenuPage::Buy:
		if (bBack || IsAction(TEXT("BuyMenu"))) { P->ShowPage(ETSMenuPage::None); return FReply::Handled(); }
		break;
	default:
		break;
	}
	return FReply::Unhandled();
}

void STSMenuRoot::BeginCapture(const FString& Action, bool bAlt)
{
	CaptureAction = Action;
	bCaptureAlt = bAlt;
}

void STSMenuRoot::FinishCapture(const FString& KeyName)
{
	if (KeyName.IsEmpty() || CaptureAction.IsEmpty()) return;
	UTSGameSubsystem* G = Game();
	if (KeyName == TEXT("Escape") && CaptureAction != TEXT("Pause"))
	{
		CaptureAction.Empty();
		return;
	}
	FString Key = KeyName;
	if (Key == TEXT("Backspace") && bCaptureAlt) Key.Empty();
	if (G != nullptr) G->SetKey(CaptureAction, Key, bCaptureAlt);
	CaptureAction.Empty();
}

// ------------------------------------------------------------------------------ main menu

TSharedRef<SWidget> STSMenuRoot::BuildMainMenu()
{
	TWeakObjectPtr<ATSPlayerController> Weak = Owner;
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot()
		.AutoWidth()
		[
			SNew(SBox)
			.WidthOverride(640.f)
			[
				SNew(SBorder)
				.BorderImage(WhiteBrush())
				.BorderBackgroundColor(PanelColor())
				.Padding(FMargin(70.f, 70.f))
				.VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 18.f))
					[
						Label(TEXT("TACTICAL\nSHOOTER"), 84.f, TextColor(), true)
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left).Padding(FMargin(0.f, 0.f, 0.f, 18.f))
					[
						Sized(SNew(SBorder).BorderImage(WhiteBrush()).BorderBackgroundColor(Accent()), 120.f, 6.f)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 36.f))
					[
						Label(TEXT("Round-based 5v5 bomb defusal template.\nSame rules and data in Unity and Unreal Engine 5."), 22.f, TextDim())
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left).Padding(FMargin(0.f, 0.f, 0.f, 18.f))
					[
						MenuButton(TEXT("PLAY VS BOTS"), [Weak]() { if (Weak.IsValid()) Weak->ShowPage(ETSMenuPage::Setup); }, 28.f, Accent(), 420.f, 72.f)
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left).Padding(FMargin(0.f, 0.f, 0.f, 18.f))
					[
						MenuButton(TEXT("SETTINGS"), [Weak]() { if (Weak.IsValid()) Weak->OpenSettings(false); }, 26.f, ButtonColor(), 420.f, 62.f)
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left).Padding(FMargin(0.f, 0.f, 0.f, 48.f))
					[
						MenuButton(TEXT("QUIT"), [Weak]() { if (Weak.IsValid()) Weak->QuitGame(); }, 26.f, ButtonColor(), 420.f, 62.f)
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						Label(TEXT("Placeholder art: every model is a basic shape.\nAll tuning lives in shared/config (copied to Content/Data)."), 18.f, TextDim())
					]
				]
			]
		]
		+ SHorizontalBox::Slot()
		.FillWidth(1.f)
		[
			SNew(SSpacer)
		];
}

// ---------------------------------------------------------------------------------- setup

FString STSMenuRoot::AgentInfo() const
{
	const UTSGameSubsystem* G = Game();
	if (G == nullptr) return FString();
	const FTSGameData& D = G->Data();
	const FTSAgentDef* A = D.Agent(G->Settings.AgentId);
	if (A == nullptr) return FString();
	FString S = FString::Printf(TEXT("%s - %s\n%s\n"), *A->DisplayName, *A->Role, *A->Description);
	for (const FTSAgentAbilitySlot& Slot : A->Abilities)
	{
		const FTSAbilityDef* Ab = D.Ability(Slot.AbilityId);
		if (Ab == nullptr) continue;
		FString Cost;
		if (Slot.IsUltimate()) Cost = FString::Printf(TEXT("ultimate, %d points"), Slot.UltPoints);
		else if (Slot.FreeChargesPerRound > 0 && Slot.Price <= 0) Cost = TEXT("free every round");
		else Cost = FString::Printf(TEXT("$%d (max %d)"), Slot.Price, Slot.MaxCharges);
		S += FString::Printf(TEXT("\n%s   %s - %s.   %s"), *Slot.Slot, *Ab->DisplayName, *Cost, *Ab->Description);
	}
	return S;
}

TSharedRef<SWidget> STSMenuRoot::BuildSetup()
{
	UTSGameSubsystem* G = Game();
	const FTSGameData& D = G->Data();
	TWeakObjectPtr<UTSGameSubsystem> WeakGame = G;
	TWeakObjectPtr<ATSPlayerController> Weak = Owner;

	// Agents: one two-line button each.
	TSharedRef<SHorizontalBox> Agents = SNew(SHorizontalBox);
	for (const FTSAgentDef& A : D.Agents)
	{
		const FString Id = A.Id;
		Agents->AddSlot()
			.AutoWidth()
			.Padding(FMargin(0.f, 0.f, 8.f, 0.f))
			[
				Sized(Button(
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)[Label(A.DisplayName.ToUpper(), 22.f, TextColor(), true, ETextJustify::Center)]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)[Label(A.Role, 16.f, TextColor(), false, ETextJustify::Center)],
					[WeakGame, Id]() { if (WeakGame.IsValid()) WeakGame->Settings.AgentId = Id; },
					TAttribute<FSlateColor>::CreateLambda([WeakGame, Id]()
					{
						return FSlateColor(WeakGame.IsValid() && WeakGame->Settings.AgentId == Id ? Accent() : ButtonColor());
					})),
					250.f, 84.f)
			];
	}

	TArray<FString> DiffLabels, DiffIds;
	for (const FTSBotDifficulty& Diff : D.Bots.Difficulties)
	{
		DiffLabels.Add(Diff.DisplayName.ToUpper());
		DiffIds.Add(Diff.Id);
	}
	TArray<FString> MapLabels, MapIds;
	for (const FString& Id : D.Game.MapRotation)
	{
		const FTSMapDef* Map = D.Map(Id);
		MapLabels.Add((Map ? Map->DisplayName : Id).ToUpper());
		MapIds.Add(Id);
	}

	return CentredPanel(
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 14.f))
		[
			Label(TEXT("MATCH SETUP"), 44.f, TextColor(), true)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 6.f))
		[
			Label(TEXT("AGENT"), 20.f, TextDim())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 10.f))
		[
			Agents
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 10.f))
		[
			Sized(DynamicLabel([this]() { return AgentInfo(); }, 20.f, TextColor()), -1.f, 170.f)
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			LabeledRow(TEXT("Starting side"), Options({ TEXT("ATTACK"), TEXT("DEFENSE") },
				[WeakGame]() { return WeakGame.IsValid() && WeakGame->Settings.PlayerSide == TEXT("defense") ? 1 : 0; },
				[WeakGame](int32 i) { if (WeakGame.IsValid()) WeakGame->Settings.PlayerSide = i == 0 ? TEXT("attack") : TEXT("defense"); }, 200.f))
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			LabeledRow(TEXT("Bot difficulty"), Options(DiffLabels,
				[WeakGame, DiffIds]() { return WeakGame.IsValid() ? DiffIds.IndexOfByKey(WeakGame->Settings.BotDifficulty) : 0; },
				[WeakGame, DiffIds](int32 i) { if (WeakGame.IsValid()) WeakGame->Settings.BotDifficulty = DiffIds[i]; }, 200.f))
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			LabeledRow(TEXT("Players per team"), Options({ TEXT("1v1"), TEXT("2v2"), TEXT("3v3"), TEXT("4v4"), TEXT("5v5") },
				[WeakGame]() { return WeakGame.IsValid() ? FMath::Clamp(WeakGame->Settings.TeamSize, 1, 5) - 1 : 4; },
				[WeakGame](int32 i) { if (WeakGame.IsValid()) WeakGame->Settings.TeamSize = i + 1; }, 110.f))
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			LabeledRow(TEXT("Match length"), Options({ TEXT("FIRST TO 13"), TEXT("FIRST TO 5"), TEXT("FIRST TO 3") },
				[WeakGame]()
				{
					for (int32 i = 0; i < 3; ++i) if (WeakGame.IsValid() && WeakGame->Settings.RoundsToWin == MatchLengths[i]) return i;
					return 0;
				},
				[WeakGame](int32 i) { if (WeakGame.IsValid()) WeakGame->Settings.RoundsToWin = MatchLengths[i]; }, 220.f))
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			LabeledRow(TEXT("Map"), Options(MapLabels,
				[WeakGame, MapIds]() { return WeakGame.IsValid() ? FMath::Max(0, MapIds.IndexOfByKey(WeakGame->Settings.MapId)) : 0; },
				[WeakGame, MapIds](int32 i) { if (WeakGame.IsValid()) WeakGame->Settings.MapId = MapIds[i]; }, 220.f))
		]
		+ SVerticalBox::Slot().FillHeight(1.f)
		[
			SNew(SSpacer)
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(0.f, 0.f, 20.f, 0.f))
			[
				MenuButton(TEXT("START MATCH"), [Weak]() { if (Weak.IsValid()) Weak->StartMatchFromSettings(); }, 28.f, Accent(), 360.f, 70.f)
			]
			+ SHorizontalBox::Slot().AutoWidth()
			[
				MenuButton(TEXT("BACK"), [Weak]() { if (Weak.IsValid()) Weak->ShowPage(ETSMenuPage::MainMenu); }, 24.f, ButtonColor(), 200.f, 70.f)
			]
		],
		1500.f, 960.f, 0.55f, 40.f);
}

// ------------------------------------------------------------------------------- settings

TSharedRef<SWidget> STSMenuRoot::BuildSettings()
{
	TWeakObjectPtr<ATSPlayerController> Weak = Owner;
	TWeakObjectPtr<UTSGameSubsystem> WeakGame = Game();
	TSharedRef<SHorizontalBox> Tabs = SNew(SHorizontalBox);
	for (int32 i = 0; i < (int32)UE_ARRAY_COUNT(SettingsTabs); ++i)
	{
		Tabs->AddSlot()
			.AutoWidth()
			.Padding(FMargin(0.f, 0.f, 8.f, 0.f))
			[
				Sized(TextButton(FText::FromString(SettingsTabs[i]), [this, i]() { SelectTab(i); }, 20.f,
					TAttribute<FSlateColor>::CreateLambda([this, i]() { return FSlateColor(SettingsTab == i ? Accent() : ButtonColor()); })),
					200.f, 52.f)
			];
	}

	TSharedRef<SWidget> Content = CentredPanel(
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 16.f))
		[
			Label(TEXT("SETTINGS"), 44.f, TextColor(), true)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 16.f))
		[
			Tabs
		]
		+ SVerticalBox::Slot().FillHeight(1.f)
		[
			SAssignNew(TabBox, SBox)
			.VAlign(VAlign_Top)
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(0.f, 0.f, 16.f, 0.f))
			[
				MenuButton(TEXT("BACK"), [Weak]() { if (Weak.IsValid()) Weak->CloseSettings(); }, 24.f, Accent(), 220.f, 60.f)
			]
			+ SHorizontalBox::Slot().AutoWidth()
			[
				MenuButton(TEXT("RESET TO DEFAULTS"), [this, WeakGame]()
				{
					CaptureAction.Empty();
					if (WeakGame.IsValid()) WeakGame->ResetSettingsKeepSetup();
				}, 22.f, ButtonColor(), 300.f, 60.f)
			]
		],
		1400.f, 940.f, 0.6f, 36.f);
	SelectTab(SettingsTab);
	return Content;
}

void STSMenuRoot::SelectTab(int32 Tab)
{
	SettingsTab = Tab;
	CaptureAction.Empty();
	if (TabBox.IsValid()) TabBox->SetContent(BuildSettingsTab(Tab));
}

TSharedRef<SWidget> STSMenuRoot::BuildSettingsTab(int32 Tab)
{
	TWeakObjectPtr<UTSGameSubsystem> G = Game();
	if (!G.IsValid()) return SNullWidget::NullWidget;
	// Getter/setter pairs on the live settings; video changes are applied right away.
	auto Apply = [G]() { if (G.IsValid()) G->ApplySettings(); };
	TSharedRef<SVerticalBox> Box = SNew(SVerticalBox);
	auto Add = [&Box](TSharedRef<SWidget> Row) { Box->AddSlot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 8.f))[Row]; };

	switch (Tab)
	{
	case 0:
		Add(SliderRow(TEXT("Mouse sensitivity"), 0.05f, 3.f,
			[G]() { return G.IsValid() ? G->Settings.MouseSensitivity : 0.f; },
			[G](float V) { if (G.IsValid()) G->Settings.MouseSensitivity = V; }, EValueFormat::Decimals));
		Add(SliderRow(TEXT("Aim-down-sights sensitivity"), 0.2f, 2.f,
			[G]() { return G.IsValid() ? G->Settings.AdsSensitivityMultiplier : 0.f; },
			[G](float V) { if (G.IsValid()) G->Settings.AdsSensitivityMultiplier = V; }, EValueFormat::Decimals));
		Add(ToggleRow(TEXT("Invert mouse Y"),
			[G]() { return G.IsValid() && G->Settings.InvertY; },
			[G](bool V) { if (G.IsValid()) G->Settings.InvertY = V; }));
		Add(SliderRow(TEXT("Field of view (horizontal)"), 80.f, 120.f,
			[G]() { return G.IsValid() ? G->Settings.FieldOfView : 0.f; },
			[G](float V) { if (G.IsValid()) G->Settings.FieldOfView = V; }, EValueFormat::Whole));
		Add(ToggleRow(TEXT("Show FPS counter"),
			[G]() { return G.IsValid() && G->Settings.ShowFps; },
			[G](bool V) { if (G.IsValid()) G->Settings.ShowFps = V; }));
		break;

	case 1:
		Add(ToggleRow(TEXT("Fullscreen (packaged builds only)"),
			[G]() { return G.IsValid() && G->Settings.Fullscreen; },
			[G, Apply](bool V) { if (G.IsValid()) { G->Settings.Fullscreen = V; Apply(); } }));
		Add(ToggleRow(TEXT("V-Sync"),
			[G]() { return G.IsValid() && G->Settings.Vsync; },
			[G, Apply](bool V) { if (G.IsValid()) { G->Settings.Vsync = V; Apply(); } }));
		Add(SliderRow(TEXT("FPS limit (0 = unlimited)"), 0.f, 300.f,
			[G]() { return G.IsValid() ? (float)G->Settings.FpsLimit : 0.f; },
			[G, Apply](float V) { if (G.IsValid()) { G->Settings.FpsLimit = FMath::RoundToInt(V); Apply(); } }, EValueFormat::Whole));
		Add(LabeledRow(TEXT("Quality"), Options({ TEXT("LOW"), TEXT("MEDIUM"), TEXT("HIGH"), TEXT("EPIC"), TEXT("CINEMATIC") },
			[G]()
			{
				if (G.IsValid() && G->Settings.QualityLevel >= 0) return G->Settings.QualityLevel;
				const UGameUserSettings* User = GEngine ? GEngine->GetGameUserSettings() : nullptr;
				return User ? User->GetOverallScalabilityLevel() : -1;
			},
			[G, Apply](int32 i) { if (G.IsValid()) { G->Settings.QualityLevel = i; Apply(); } }, 170.f, 18.f)));
		break;

	case 2:
		Add(SliderRow(TEXT("Master volume"), 0.f, 1.f,
			[G]() { return G.IsValid() ? G->Settings.MasterVolume : 0.f; },
			[G](float V) { if (G.IsValid()) G->Settings.MasterVolume = V; }, EValueFormat::Percent));
		Add(Label(TEXT("Every sound is synthesised at startup from shared/config/audio.json (copied to Content/Data). "
			"Replace ATSAudioHost's procedural voices with USoundBase assets to use real sounds."), 18.f, TextDim()));
		break;

	case 3:
		Add(BuildControls());
		break;

	default:
	{
		TArray<FString> Hex;
		for (const TCHAR* C : CrosshairColors) Hex.Add(C);
		Add(LabeledRow(TEXT("Colour"), Options({ TEXT("GREEN"), TEXT("CYAN"), TEXT("WHITE"), TEXT("YELLOW"), TEXT("RED"), TEXT("PINK") },
			[G, Hex]() { return G.IsValid() ? Hex.IndexOfByPredicate([&G](const FString& H) { return H.Equals(G->Settings.CrosshairColor, ESearchCase::IgnoreCase); }) : 0; },
			[G, Hex](int32 i) { if (G.IsValid()) G->Settings.CrosshairColor = Hex[i]; }, 150.f, 18.f)));
		Add(SliderRow(TEXT("Line length"), 1.f, 20.f,
			[G]() { return G.IsValid() ? G->Settings.CrosshairSize : 0.f; },
			[G](float V) { if (G.IsValid()) G->Settings.CrosshairSize = V; }, EValueFormat::Whole));
		Add(SliderRow(TEXT("Gap"), 0.f, 15.f,
			[G]() { return G.IsValid() ? G->Settings.CrosshairGap : 0.f; },
			[G](float V) { if (G.IsValid()) G->Settings.CrosshairGap = V; }, EValueFormat::Whole));
		Add(SliderRow(TEXT("Thickness"), 1.f, 6.f,
			[G]() { return G.IsValid() ? G->Settings.CrosshairThickness : 0.f; },
			[G](float V) { if (G.IsValid()) G->Settings.CrosshairThickness = V; }, EValueFormat::Whole));
		Add(ToggleRow(TEXT("Centre dot"),
			[G]() { return G.IsValid() && G->Settings.CrosshairDot; },
			[G](bool V) { if (G.IsValid()) G->Settings.CrosshairDot = V; }));
		Add(ToggleRow(TEXT("Dynamic (shows weapon spread)"),
			[G]() { return G.IsValid() && G->Settings.CrosshairDynamic; },
			[G](bool V) { if (G.IsValid()) G->Settings.CrosshairDynamic = V; }));
		Add(LabeledRow(TEXT("Preview"), Sized(SNew(STSCrosshairPreview).Game(G), 120.f, 120.f), 124.f));
		break;
	}
	}
	return Box;
}

TSharedRef<SWidget> STSMenuRoot::BuildControls()
{
	TWeakObjectPtr<UTSGameSubsystem> G = Game();
	const TArray<FString>& Actions = TSKeyNames::Actions();
	TSharedRef<SHorizontalBox> Columns = SNew(SHorizontalBox);
	const int32 PerColumn = (Actions.Num() + 1) / 2;
	for (int32 Column = 0; Column < 2; ++Column)
	{
		TSharedRef<SVerticalBox> List = SNew(SVerticalBox);
		for (int32 i = Column * PerColumn; i < FMath::Min(Actions.Num(), (Column + 1) * PerColumn); ++i)
		{
			const FString Action = Actions[i];
			TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					Sized(Label(TSKeyNames::ActionLabel(Action), 19.f, TextDim()), 310.f, -1.f)
				];
			for (int32 Alt = 0; Alt < 2; ++Alt)
			{
				const bool bAlt = Alt == 1;
				Row->AddSlot()
					.AutoWidth()
					.Padding(FMargin(8.f, 0.f, 0.f, 0.f))
					[
						Sized(TextButton(
							TAttribute<FText>::CreateLambda([this, G, Action, bAlt]()
							{
								if (CaptureAction == Action && bCaptureAlt == bAlt) return FText::FromString(TEXT("press a key..."));
								if (!G.IsValid()) return FText::GetEmpty();
								return FText::FromString(TSKeyNames::Label(bAlt ? G->Keys.AltKey(Action) : G->Keys.Key(Action)));
							}),
							[this, Action, bAlt]() { BeginCapture(Action, bAlt); }, 19.f,
							TAttribute<FSlateColor>::CreateLambda([this, Action, bAlt]()
							{
								return FSlateColor(CaptureAction == Action && bCaptureAlt == bAlt ? Accent() : ButtonColor());
							})),
							160.f, 44.f)
					];
			}
			List->AddSlot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 6.f))[Row];
		}
		Columns->AddSlot().AutoWidth().Padding(FMargin(0.f, 0.f, 20.f, 0.f))[List];
	}
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			Columns
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 6.f, 0.f, 0.f))
		[
			Label(TEXT("Click a key, then press the new key or mouse button. Esc cancels, Backspace clears the alternative key."), 17.f, TextDim())
		];
}

// ---------------------------------------------------------------------------------- pause

TSharedRef<SWidget> STSMenuRoot::BuildPause()
{
	TWeakObjectPtr<ATSPlayerController> Weak = Owner;
	return CentredPanel(
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 20.f))
		[
			Label(TEXT("PAUSED"), 48.f, TextColor(), true, ETextJustify::Center)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 16.f))
		[
			MenuButton(TEXT("RESUME"), [Weak]() { if (Weak.IsValid()) Weak->SetPaused(false); }, 26.f, Accent(), -1.f, 64.f)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 16.f))
		[
			MenuButton(TEXT("SETTINGS"), [Weak]() { if (Weak.IsValid()) Weak->OpenSettings(true); }, 24.f, ButtonColor(), -1.f, 60.f)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 16.f))
		[
			MenuButton(TEXT("LEAVE MATCH"), [Weak]() { if (Weak.IsValid()) Weak->LeaveMatch(); }, 24.f, ButtonColor(), -1.f, 60.f)
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			MenuButton(TEXT("QUIT GAME"), [Weak]() { if (Weak.IsValid()) Weak->QuitGame(); }, 24.f, ButtonColor(), -1.f, 60.f)
		],
		520.f, 560.f, 0.6f, 40.f);
}

// ------------------------------------------------------------------------------------ buy

ETSShopResult STSMenuRoot::BuyCheck(const FTSShopItem& Item) const
{
	ATSGameMode* M = Mode();
	FTSPlayerRecord* P = Local();
	const UTSGameSubsystem* G = Game();
	if (M == nullptr || P == nullptr || G == nullptr) return ETSShopResult::NotAllowed;
	const FTSGameData& D = G->Data();
	return TSShop::Check(D, D.Agent(P->AgentId), M->SideOf(*P), P->Loadout, P->Money, Item.Id);
}

bool STSMenuRoot::CanSellItem(const FTSShopItem& Item) const
{
	const ATSGameMode* M = Mode();
	const FTSPlayerRecord* P = Local();
	return M != nullptr && P != nullptr && M->Flow.CanSell() && TSShop::CanSell(P->Loadout, Item.Id);
}

bool STSMenuRoot::IsOwned(const FTSShopItem& Item) const
{
	const FTSPlayerRecord* P = Local();
	const UTSGameSubsystem* G = Game();
	if (P == nullptr || G == nullptr) return false;
	const FTSLoadout& Lo = P->Loadout;
	switch (Item.Kind)
	{
	case ETSItemKind::Weapon: return Lo.PrimaryId == Item.Id || Lo.SecondaryId == Item.Id;
	case ETSItemKind::Armor:
	{
		const FTSEquipmentDef* E = G->Data().EquipmentItem(Item.Id);
		return E != nullptr && Lo.Armor > 0 && E->Amount == Lo.Armor;
	}
	case ETSItemKind::DefuseKit: return Lo.bHasDefuseKit;
	default: return Item.AbilitySlot >= 0 && Item.AbilitySlot < 4 && Lo.AbilityCharges[Item.AbilitySlot] > 0;
	}
}

FString STSMenuRoot::BuyItemTitle(const FTSShopItem& Item) const
{
	if (Item.Kind != ETSItemKind::Ability) return Item.DisplayName;
	const FTSPlayerRecord* P = Local();
	const UTSGameSubsystem* G = Game();
	const FTSAgentDef* Agent = P && G ? G->Data().Agent(P->AgentId) : nullptr;
	const FString SlotKey = Agent && Agent->Abilities.IsValidIndex(Item.AbilitySlot) ? Agent->Abilities[Item.AbilitySlot].Slot + TEXT("  ") : FString();
	const int32 Charges = P && Item.AbilitySlot >= 0 && Item.AbilitySlot < 4 ? P->Loadout.AbilityCharges[Item.AbilitySlot] : 0;
	return FString::Printf(TEXT("%s%s  [%d/%d]"), *SlotKey, *Item.DisplayName, Charges, Item.MaxCharges);
}

FString STSMenuRoot::BuyItemPrice(const FTSShopItem& Item) const
{
	if (Item.bForSale) return FString::Printf(TEXT("$%d"), Item.Price);
	return Item.Kind == ETSItemKind::Ability ? TEXT("not for sale") : FString();
}

float STSMenuRoot::BuyTimeLeft() const
{
	const ATSGameMode* M = Mode();
	const UTSGameSubsystem* G = Game();
	if (M == nullptr || G == nullptr) return 0.f;
	const float Grace = G->Data().Game.Round.BuyGraceSeconds;
	if (M->Flow.Phase == ETSMatchPhase::BuyPhase) return M->Flow.PhaseTimeLeft + Grace;
	return FMath::Max(0.f, Grace - M->Flow.LiveElapsed);
}

TSharedRef<SWidget> STSMenuRoot::BuildBuyItem(const FTSShopItem& Item)
{
	const FString Id = Item.Id;
	return SNew(SBorder)
		.BorderImage(FStyleDefaults::GetNoBrush())
		.Padding(0.f)
		.OnMouseButtonDown_Lambda([this, Id](const FGeometry&, const FPointerEvent& E)
		{
			// SButton ignores the right button, so it bubbles up to here: sell back.
			if (E.GetEffectingButton() != EKeys::RightMouseButton) return FReply::Unhandled();
			ATSGameMode* M = Mode();
			FTSPlayerRecord* P = Local();
			if (M != nullptr && P != nullptr) M->TrySell(*P, Id);
			return FReply::Handled();
		})
		[
			SNew(SBox)
			.HeightOverride(78.f)
			[
				SNew(SButton)
				.ButtonStyle(&FlatButton())
				.ButtonColorAndOpacity_Lambda([this, Item]() { return FSlateColor(IsOwned(Item) ? OwnedColor() : ButtonColor()); })
				.IsEnabled_Lambda([this, Item]() { return BuyCheck(Item) == ETSShopResult::Ok || CanSellItem(Item); })
				.VAlign(VAlign_Center)
				.OnClicked_Lambda([this, Id]()
				{
					ATSGameMode* M = Mode();
					FTSPlayerRecord* P = Local();
					if (M != nullptr && P != nullptr) M->TryBuy(*P, Id);
					return FReply::Handled();
				})
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						DynamicLabel([this, Item]() { return BuyItemTitle(Item); }, 19.f, TextColor(), true)
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock)
						.Text(FText::FromString(BuyItemPrice(Item)))
						.Font(Font(17.f))
						.ColorAndOpacity_Lambda([this, Item]() { return FSlateColor(BuyCheck(Item) == ETSShopResult::Ok ? Good() : TextDim()); })
					]
				]
			]
		];
}

TSharedRef<SWidget> STSMenuRoot::BuildBuy()
{
	FTSPlayerRecord* P = Local();
	UTSGameSubsystem* G = Game();
	if (P == nullptr) return SNullWidget::NullWidget;
	const FTSGameData& D = G->Data();
	const TArray<FTSShopItem> Catalog = TSShop::Catalog(D, D.Agent(P->AgentId));

	TSharedRef<SHorizontalBox> Columns = SNew(SHorizontalBox);
	for (const FString& Group : TSShop::GroupOrder())
	{
		TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);
		Column->AddSlot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 8.f))[Label(Group.ToUpper(), 20.f, TextDim(), true)];
		int32 Count = 0;
		for (const FTSShopItem& Item : Catalog)
		{
			if (Item.Group != Group) continue;
			++Count;
			Column->AddSlot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 8.f))[BuildBuyItem(Item)];
		}
		if (Count > 0) Columns->AddSlot().AutoWidth().Padding(FMargin(0.f, 0.f, 14.f, 0.f))[Sized(Column, 232.f, -1.f)];
	}

	TWeakObjectPtr<UTSGameSubsystem> WeakGame = G;
	return CentredPanel(
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 0.f, 0.f, 14.f))
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				Sized(Label(TEXT("BUY"), 44.f, TextColor(), true), 160.f, -1.f)
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				Sized(DynamicLabel([this]() { const FTSPlayerRecord* L = Local(); return L ? FString::Printf(TEXT("$%d"), L->Money) : FString(); },
					36.f, Good(), true), 300.f, -1.f)
			]
			+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
			[
				DynamicLabel([this, WeakGame]()
				{
					const FString Key = WeakGame.IsValid() ? TSKeyNames::Label(WeakGame->Keys.Key(TEXT("BuyMenu"))) : FString();
					return FString::Printf(TEXT("Left click: buy   Right click: sell back (buy phase only)   %s/Esc: close   Buy time left: %ds"),
						*Key, FMath::CeilToInt(BuyTimeLeft()));
				}, 20.f, TextDim(), false, ETextJustify::Right)
			]
		]
		+ SVerticalBox::Slot().FillHeight(1.f)
		[
			Columns
		],
		1760.f, 820.f, 0.45f, 30.f);
}

// ------------------------------------------------------------------------------ match end

TSharedRef<SWidget> STSMenuRoot::BuildScoreTable()
{
	ATSGameMode* M = Mode();
	const FTSPlayerRecord* Me = Local();
	const UTSGameSubsystem* G = Game();
	TSharedRef<SVerticalBox> Table = SNew(SVerticalBox);
	if (M == nullptr || Me == nullptr || G == nullptr) return Table;
	const FTSGameData& D = G->Data();
	static const float Columns[] = { 330.f, 170.f, 80.f, 80.f, 80.f, 100.f, 130.f, 90.f };
	const TCHAR* Titles[] = { TEXT("PLAYER"), TEXT("AGENT"), TEXT("K"), TEXT("D"), TEXT("A"), TEXT("SCORE"), TEXT("MONEY"), TEXT("ULT") };

	auto MakeRow = [](const TArray<FString>& Cells, float Px, const FLinearColor& Color)
	{
		TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
		for (int32 c = 0; c < Cells.Num(); ++c)
			Row->AddSlot().AutoWidth().VAlign(VAlign_Center)
			[
				Sized(Label(Cells[c], Px, Color, false, c == 0 ? ETextJustify::Left : ETextJustify::Center), Columns[c], -1.f)
			];
		return Row;
	};

	const ETSTeam Order[] = { Me->Team, TSIds::Other(Me->Team) };
	for (const ETSTeam Team : Order)
	{
		const ETSSide Side = M->Flow.SideOf(Team);
		const FLinearColor SideColor = UTSGameSubsystem::Color(Side == ETSSide::Attack ? D.Game.Visuals.AttackColor : D.Game.Visuals.DefenseColor);
		Table->AddSlot().AutoHeight().Padding(FMargin(0.f, 8.f, 0.f, 4.f))
		[
			Label(FString::Printf(TEXT("%s  -  %s  -  %d"), Team == Me->Team ? TEXT("YOUR TEAM") : TEXT("ENEMY TEAM"),
				Side == ETSSide::Attack ? TEXT("ATTACK") : TEXT("DEFENSE"), M->Flow.Score[TSIds::Index(Team)]), 26.f, SideColor, true)
		];
		TArray<FString> Head;
		for (const TCHAR* T : Titles) Head.Add(T);
		Table->AddSlot().AutoHeight()[MakeRow(Head, 17.f, TextDim())];

		TArray<const FTSPlayerRecord*> Players;
		for (const FTSPlayerRecord& P : M->Players) if (P.Team == Team) Players.Add(&P);
		Players.Sort([](const FTSPlayerRecord& A, const FTSPlayerRecord& B) { return A.Score != B.Score ? A.Score > B.Score : A.Kills > B.Kills; });
		for (const FTSPlayerRecord* P : Players)
		{
			const FTSAgentDef* Agent = D.Agent(P->AgentId);
			const int32 Ult = FTSPlayerRecord::UltCost(Agent);
			TArray<FString> Cells;
			Cells.Add((P->bIsLocal ? TEXT("> ") : TEXT("")) + P->Name + (P->bIsBot ? TEXT("  BOT") : TEXT("")));
			Cells.Add(Agent ? Agent->DisplayName : P->AgentId);
			Cells.Add(FString::FromInt(P->Kills));
			Cells.Add(FString::FromInt(P->Deaths));
			Cells.Add(FString::FromInt(P->Assists));
			Cells.Add(FString::FromInt(P->Score));
			Cells.Add(Team == Me->Team ? FString::Printf(TEXT("$%d"), P->Money) : FString());
			Cells.Add(Ult > 0 ? FString::Printf(TEXT("%d/%d"), P->UltPoints, Ult) : TEXT("-"));
			Table->AddSlot().AutoHeight().Padding(FMargin(0.f, 2.f))
			[
				SNew(SBorder)
				.BorderImage(WhiteBrush())
				.BorderBackgroundColor(P->bIsLocal ? FLinearColor(Accent().R, Accent().G, Accent().B, 0.18f) : FLinearColor(1.f, 1.f, 1.f, 0.05f))
				.Padding(FMargin(0.f, 6.f))
				[
					MakeRow(Cells, 20.f, TextColor())
				]
			];
		}
	}
	return Table;
}

TSharedRef<SWidget> STSMenuRoot::BuildMatchEnd()
{
	ATSGameMode* M = Mode();
	const FTSPlayerRecord* Me = Local();
	if (M == nullptr || Me == nullptr) return SNullWidget::NullWidget;
	const int32 Mine = TSIds::Index(Me->Team);
	FString Title = TEXT("DEFEAT");
	FLinearColor TitleColor = Accent();
	if (M->Flow.bIsDraw) { Title = TEXT("DRAW"); TitleColor = Warn(); }
	else if (M->Flow.Winner == Me->Team) { Title = TEXT("VICTORY"); TitleColor = Good(); }
	FString Subtitle = FString::Printf(TEXT("%d - %d"), M->Flow.Score[Mine], M->Flow.Score[1 - Mine]);
	if (const FTSPlayerRecord* Mvp = M->Record(M->MvpId))
		Subtitle += FString::Printf(TEXT("    MVP: %s (%d pts)"), *Mvp->Name, Mvp->Score);

	TWeakObjectPtr<ATSPlayerController> Weak = Owner;
	return CentredPanel(
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			Label(Title, 72.f, TitleColor, true, ETextJustify::Center)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 4.f, 0.f, 12.f))
		[
			Label(Subtitle, 26.f, TextDim(), false, ETextJustify::Center)
		]
		+ SVerticalBox::Slot().FillHeight(1.f).HAlign(HAlign_Center)
		[
			BuildScoreTable()
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(0.f, 0.f, 20.f, 0.f))
			[
				MenuButton(TEXT("PLAY AGAIN"), [Weak]() { if (Weak.IsValid()) Weak->StartMatchFromSettings(); }, 26.f, Accent(), 300.f, 70.f)
			]
			+ SHorizontalBox::Slot().AutoWidth()
			[
				MenuButton(TEXT("MAIN MENU"), [Weak]() { if (Weak.IsValid()) Weak->LeaveMatch(); }, 24.f, ButtonColor(), 260.f, 70.f)
			]
		],
		1300.f, 940.f, 0.7f, 36.f);
}
