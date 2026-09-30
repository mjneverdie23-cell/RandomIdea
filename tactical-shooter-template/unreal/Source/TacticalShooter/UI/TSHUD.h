#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "Game/TSTypes.h"
#include "TSHUD.generated.h"

class ATSGameMode;
class ATSCharacter;
class ATSPlayerController;
class UTexture2D;
class UFont;

/**
 * The in-game HUD drawn with the canvas: scores and clock, minimap, killfeed, vitals,
 * abilities, ammo and money, crosshair, hit markers, interaction bar, announcements, screen
 * effects (flash, smoke, damage, scope), world markers and the scoreboard. It only reads game
 * state and listens to ATSGameMode's events. Menus are Slate (STSMenuRoot). Mirrors HudScreen.cs.
 */
UCLASS()
class TACTICALSHOOTER_API ATSHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void DrawHUD() override;

private:
	struct FFeedEntry
	{
		FString Killer, Source, Victim;
		FLinearColor KillerColor, VictimColor;
		bool bLocal = false;
		float Until = 0.f;
	};

	void Bind();
	void OnKill(const FTSKillEvent& E);
	void OnDamage(const FTSDamageEvent& E);
	void OnAnnounce(const FString& Text, float Seconds);

	void DrawOverlays(ATSGameMode* M, ATSCharacter* View);
	void DrawCrosshair(ATSCharacter* View);
	void DrawTopBar(ATSGameMode* M);
	void DrawMinimap(ATSGameMode* M);
	void DrawKillfeed();
	void DrawVitals(ATSGameMode* M, ATSCharacter* Subject);
	void DrawInteraction(ATSGameMode* M, ATSCharacter* Local);
	void DrawBanner();
	void DrawWorldMarkers(ATSGameMode* M, ATSCharacter* View);
	void DrawScoreboard(ATSGameMode* M);

	void Rect(float X, float Y, float W, float H, const FLinearColor& Color);
	/** Draws text; Align 0 = left, 0.5 = centre, 1 = right of X. Size is in reference pixels (1080p). */
	void Label(const FString& Text, float X, float Y, float Size, const FLinearColor& Color, float Align = 0.f, bool bBold = false);
	float LabelWidth(const FString& Text, float Size, bool bBold = false);
	FLinearColor SideColor(ATSGameMode* M, ETSTeam Team) const;
	FVector2D ToMinimap(const FVector& World) const;
	void UpdateSpotted(ATSGameMode* M, ETSTeam Team);

	TWeakObjectPtr<ATSGameMode> BoundMode;
	FDelegateHandle KillHandle, DamageHandle, AnnounceHandle;
	TArray<FFeedEntry> Feed;
	FString BannerText;
	float BannerUntil = 0.f;
	float HitTime = -9.f;
	bool bHitKill = false;
	float DamageFlash = 0.f;
	float FpsAccum = 0.f;
	int32 FpsFrames = 0;
	FString FpsText;
	float Scale = 1.f;

	/** Enemies a teammate can see; refreshed 10 times a second (one sight test per pair). */
	TSet<int32> SpottedIds;
	float NextSpotTime = 0.f;

	UPROPERTY() TObjectPtr<UTexture2D> MinimapTexture;
	FString MinimapFor;
	FVector2D MinimapOrigin = FVector2D::ZeroVector;
	FVector2D MinimapSize = FVector2D::ZeroVector;
	float MapWidthCm = 1.f;
	float MapHeightCm = 1.f;
};
