#include "UI/TSHUD.h"
#include "Core/TSKeyNames.h"
#include "Game/TSCharacter.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"
#include "Game/TSPlayerController.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "Engine/Texture2D.h"
#include "Engine/World.h"

namespace
{
	const FLinearColor HudText(0.94f, 0.95f, 0.97f, 1.f);
	const FLinearColor HudDim(0.62f, 0.67f, 0.72f, 1.f);
	const FLinearColor HudAccent(1.f, 0.28f, 0.34f, 1.f);
	const FLinearColor HudGood(0.35f, 0.85f, 0.55f, 1.f);
	const FLinearColor HudWarn(1.f, 0.8f, 0.3f, 1.f);
	const FLinearColor HudPanel(0.f, 0.f, 0.f, 0.55f);

	UFont* HudFont() { return GEngine ? GEngine->GetLargeFont() : nullptr; }

	TArray<FString> Lines(const FString& Text)
	{
		TArray<FString> Out;
		Text.ParseIntoArray(Out, TEXT("\n"), false);
		return Out;
	}
}

void ATSHUD::BeginPlay()
{
	Super::BeginPlay();
	Bind();
}

void ATSHUD::EndPlay(const EEndPlayReason::Type Reason)
{
	if (ATSGameMode* M = BoundMode.Get())
	{
		M->OnKill.Remove(KillHandle);
		M->OnDamage.Remove(DamageHandle);
		M->OnAnnounce.Remove(AnnounceHandle);
	}
	Super::EndPlay(Reason);
}

void ATSHUD::Bind()
{
	ATSGameMode* M = GetWorld() ? GetWorld()->GetAuthGameMode<ATSGameMode>() : nullptr;
	if (M == nullptr || BoundMode.Get() == M) return;
	BoundMode = M;
	KillHandle = M->OnKill.AddUObject(this, &ATSHUD::OnKill);
	DamageHandle = M->OnDamage.AddUObject(this, &ATSHUD::OnDamage);
	AnnounceHandle = M->OnAnnounce.AddUObject(this, &ATSHUD::OnAnnounce);
}

void ATSHUD::OnAnnounce(const FString& Text, float Seconds)
{
	BannerText = Text;
	BannerUntil = GetWorld()->GetRealTimeSeconds() + Seconds;
}

void ATSHUD::OnDamage(const FTSDamageEvent& E)
{
	ATSGameMode* M = BoundMode.Get();
	if (M == nullptr) return;
	if (E.AttackerId == M->LocalId && E.VictimId != M->LocalId)
	{
		HitTime = GetWorld()->GetRealTimeSeconds();
		bHitKill = E.bKilled;
		M->PlaySound2D(E.Zone == ETSHitZone::Head ? TEXT("hit_head") : TEXT("hit_body"));
	}
	if (E.VictimId == M->LocalId)
	{
		DamageFlash = FMath::Min(0.45f, DamageFlash + (E.HealthDamage + E.ArmorDamage) / 120.f);
		M->PlaySound2D(TEXT("hurt"));
	}
}

void ATSHUD::OnKill(const FTSKillEvent& E)
{
	ATSGameMode* M = BoundMode.Get();
	if (M == nullptr) return;
	const FTSPlayerRecord* Killer = M->Record(E.KillerId);
	const FTSPlayerRecord* Victim = M->Record(E.VictimId);
	const FTSPlayerRecord* Assist = M->Record(E.AssisterId);
	if (Killer && Victim && Killer->bIsLocal && Victim->Team != Killer->Team) M->PlaySound2D(TEXT("kill_confirm"));
	FFeedEntry F;
	if (Killer && Killer != Victim) F.Killer = Killer->Name + (Assist ? TEXT(" + ") + Assist->Name : FString());
	F.Source = FString::Printf(TEXT("[%s%s]"), *E.SourceName, E.bHeadshot ? TEXT(" HS") : TEXT(""));
	F.Victim = Victim ? Victim->Name : FString();
	F.KillerColor = Killer ? SideColor(M, Killer->Team) : HudText;
	F.VictimColor = Victim ? SideColor(M, Victim->Team) : HudText;
	F.bLocal = (Killer && Killer->bIsLocal) || (Victim && Victim->bIsLocal);
	F.Until = GetWorld()->GetRealTimeSeconds() + 6.f;
	Feed.Insert(F, 0);
	if (Feed.Num() > 6) Feed.RemoveAt(Feed.Num() - 1);
}

FLinearColor ATSHUD::SideColor(ATSGameMode* M, ETSTeam Team) const
{
	const FTSVisualSettings& V = UTSGameSubsystem::Get(this)->Data().Game.Visuals;
	return UTSGameSubsystem::Color(M->Flow.SideOf(Team) == ETSSide::Attack ? V.AttackColor : V.DefenseColor);
}

// ---------------------------------------------------------------------------------- helpers

void ATSHUD::Rect(float X, float Y, float W, float H, const FLinearColor& Color)
{
	DrawRect(Color, X * Scale, Y * Scale, W * Scale, H * Scale);
}

float ATSHUD::LabelWidth(const FString& Text, float Size, bool bBold)
{
	float W = 0.f, H = 0.f;
	GetTextSize(Text, W, H, HudFont(), Size / 24.f * Scale);
	return W / Scale + (bBold ? 1.f : 0.f);
}

void ATSHUD::Label(const FString& Text, float X, float Y, float Size, const FLinearColor& Color, float Align, bool bBold)
{
	if (Text.IsEmpty()) return;
	const float TextScale = Size / 24.f * Scale;
	float W = 0.f, H = 0.f;
	GetTextSize(Text, W, H, HudFont(), TextScale);
	const float PX = X * Scale - W * Align;
	const float PY = Y * Scale;
	DrawText(Text, FLinearColor(0.f, 0.f, 0.f, Color.A * 0.7f), PX + 1.5f, PY + 1.5f, HudFont(), TextScale);
	DrawText(Text, Color, PX, PY, HudFont(), TextScale);
	if (bBold) DrawText(Text, Color, PX + 1.f, PY, HudFont(), TextScale);
}

// ------------------------------------------------------------------------------------- draw

void ATSHUD::DrawHUD()
{
	Super::DrawHUD();
	Bind();
	ATSGameMode* M = BoundMode.Get();
	ATSPlayerController* PC = Cast<ATSPlayerController>(GetOwningPlayerController());
	if (M == nullptr || PC == nullptr || Canvas == nullptr || !M->IsRunning() || M->Players.Num() == 0) return;
	Scale = Canvas->ClipY / 1080.f;
	const float Now = GetWorld()->GetRealTimeSeconds();
	ATSCharacter* Local = M->LocalCharacter();
	ATSCharacter* View = PC->ViewedCharacter();
	ATSCharacter* Subject = View ? View : Local;

	DrawOverlays(M, View);
	DrawWorldMarkers(M, View);
	DrawCrosshair(View);
	DrawTopBar(M);
	DrawMinimap(M);
	DrawKillfeed();
	if (Subject) DrawVitals(M, Subject);
	DrawInteraction(M, Local);
	DrawBanner();

	const bool bAlive = Local && Local->IsAlive();
	if (!bAlive && View && View != Local)
		Label(FString::Printf(TEXT("SPECTATING %s   (%s: next)"), *View->Record->Name.ToUpper(), *TSKeyNames::Label(UTSGameSubsystem::Get(this)->Keys.Key(TEXT("Fire")))),
			960.f, 880.f, 24.f, HudText, 0.5f);
	else if (!bAlive) Label(TEXT("YOU ARE DEAD"), 960.f, 880.f, 24.f, HudText, 0.5f);

	if (PC->IsScoreboardHeld()) DrawScoreboard(M);

	FpsAccum += GetWorld()->GetDeltaSeconds();
	++FpsFrames;
	if (FpsAccum >= 0.5f)
	{
		FpsText = FString::Printf(TEXT("%d FPS"), FMath::RoundToInt(FpsFrames / FMath::Max(0.001f, FpsAccum)));
		FpsAccum = 0.f;
		FpsFrames = 0;
	}
	if (UTSGameSubsystem::Get(this)->Settings.ShowFps) Label(FpsText, Canvas->ClipX / Scale - 20.f, 10.f, 16.f, HudDim, 1.f);
	for (int32 i = Feed.Num() - 1; i >= 0; --i) if (Now > Feed[i].Until) Feed.RemoveAt(i);
}

void ATSHUD::DrawOverlays(ATSGameMode* M, ATSCharacter* View)
{
	const float W = Canvas->ClipX / Scale, H = 1080.f;
	if (View == nullptr) return;
	if (View->BlindTimeLeft > 0.f)
		Rect(0.f, 0.f, W, H, FLinearColor(1.f, 1.f, 1.f, FMath::Clamp(View->BlindTimeLeft / FMath::Max(0.3f, View->BlindDuration * 0.6f), 0.f, 1.f)));
	if (M->Effects.InsideSmoke(View->EyePosition())) Rect(0.f, 0.f, W, H, FLinearColor(0.55f, 0.55f, 0.6f, 1.f));
	DamageFlash = FMath::Max(0.f, DamageFlash - GetWorld()->GetDeltaSeconds() * 0.8f);
	if (DamageFlash > 0.01f) Rect(0.f, 0.f, W, H, FLinearColor(0.8f, 0.f, 0.f, DamageFlash));
	const FTSWeaponDef* Weapon = View->Weapons.CurrentDef();
	if (View->IsAlive() && View->Weapons.bAiming && Weapon && Weapon->Scoped)
	{
		const float Half = 400.f, CX = W / 2.f, CY = H / 2.f;
		Rect(0.f, 0.f, W, CY - Half, FLinearColor::Black);
		Rect(0.f, CY + Half, W, H - CY - Half, FLinearColor::Black);
		Rect(0.f, CY - Half, CX - Half, Half * 2.f, FLinearColor::Black);
		Rect(CX + Half, CY - Half, W - CX - Half, Half * 2.f, FLinearColor::Black);
		Rect(CX - Half, CY - 1.f, Half * 2.f, 2.f, FLinearColor::Black);
		Rect(CX - 1.f, CY - Half, 2.f, Half * 2.f, FLinearColor::Black);
	}
}

void ATSHUD::DrawCrosshair(ATSCharacter* View)
{
	if (View == nullptr || !View->IsAlive()) return;
	const FTSWeaponDef* Weapon = View->Weapons.CurrentDef();
	if (View->Weapons.bAiming && Weapon && Weapon->Scoped) return;
	const FTSUserSettings& S = UTSGameSubsystem::Get(this)->Settings;
	const FLinearColor C = UTSGameSubsystem::Color(S.CrosshairColor);
	const float CX = Canvas->ClipX / Scale / 2.f, CY = 540.f;
	const float Len = S.CrosshairSize, T = S.CrosshairThickness;
	const float Gap = S.CrosshairGap + (S.CrosshairDynamic ? View->Weapons.CurrentSpread * 6.f : 0.f);
	Rect(CX - T / 2.f, CY - Gap - Len, T, Len, C);
	Rect(CX - T / 2.f, CY + Gap, T, Len, C);
	Rect(CX - Gap - Len, CY - T / 2.f, Len, T, C);
	Rect(CX + Gap, CY - T / 2.f, Len, T, C);
	if (S.CrosshairDot) Rect(CX - T / 2.f, CY - T / 2.f, T, T, C);

	const float Since = GetWorld()->GetRealTimeSeconds() - HitTime;
	if (Since < 0.18f)
	{
		const FLinearColor HC = bHitKill ? HudAccent : FLinearColor::White;
		for (int32 i = 0; i < 4; ++i)
		{
			const float SX = (i % 2 == 0) ? 1.f : -1.f, SY = (i < 2) ? 1.f : -1.f;
			const FVector2D A((CX + SX * 7.f) * Scale, (CY + SY * 7.f) * Scale);
			const FVector2D B((CX + SX * 15.f) * Scale, (CY + SY * 15.f) * Scale);
			DrawLine((float)A.X, (float)A.Y, (float)B.X, (float)B.Y, HC, 2.f * Scale);
		}
	}
}

void ATSHUD::DrawTopBar(ATSGameMode* M)
{
	const FTSMatchFlow& Flow = M->Flow;
	const FTSPlayerRecord* Local = M->LocalRecord();
	if (Local == nullptr) return;
	const ETSTeam Mine = Local->Team, Theirs = TSIds::Other(Mine);
	const float CX = Canvas->ClipX / Scale / 2.f;
	Rect(CX - 280.f, 10.f, 560.f, 92.f, HudPanel);
	Label(FString::FromInt(Flow.Score[TSIds::Index(Mine)]), CX - 220.f, 20.f, 44.f, SideColor(M, Mine), 0.5f, true);
	Label(FString::FromInt(Flow.Score[TSIds::Index(Theirs)]), CX + 220.f, 20.f, 44.f, SideColor(M, Theirs), 0.5f, true);
	const int32 Secs = FMath::Max(0, FMath::CeilToInt(Flow.ClockSeconds()));
	if (!(Flow.Phase == ETSMatchPhase::Live && Flow.bBombPlanted))
		Label(FString::Printf(TEXT("%d:%02d"), Secs / 60, Secs % 60), CX, 18.f, 40.f, HudText, 0.5f, true);
	Label(FString::Printf(TEXT("ROUND %d%s"), Flow.Round, Flow.bInOvertime ? TEXT("  OT") : TEXT("")), CX, 70.f, 16.f, HudDim, 0.5f);

	for (int32 T = 0; T < 2; ++T)
	{
		const ETSTeam Team = T == 0 ? Mine : Theirs;
		int32 N = 0;
		for (const FTSPlayerRecord& P : M->Players)
		{
			if (P.Team != Team) continue;
			const float X = T == 0 ? CX - 162.f + N * 16.f : CX + 150.f - N * 16.f;
			Rect(X, 80.f, 12.f, 12.f, P.bAlive ? SideColor(M, Team) : FLinearColor(0.3f, 0.3f, 0.3f, 0.8f));
			++N;
		}
	}

	FString Phase;
	if (Flow.Phase == ETSMatchPhase::BuyPhase) Phase = TEXT("BUY PHASE");
	else if (Flow.Phase == ETSMatchPhase::Halftime) Phase = TEXT("HALFTIME");
	else if (Flow.Phase == ETSMatchPhase::Live && Flow.bBombPlanted) Phase = TEXT("BOMB PLANTED - SITE ") + TSIds::SiteName(Flow.BombSite);
	Label(Phase, CX, 110.f, 22.f, HudWarn, 0.5f, true);
	if (Flow.Phase == ETSMatchPhase::Live && Flow.bBombPlanted && !Flow.bBombDefused)
	{
		const float Frac = Flow.BombTimeLeft / FMath::Max(1.f, UTSGameSubsystem::Get(this)->Data().Game.Bomb.FuseSeconds);
		Rect(CX - 200.f, 140.f, 400.f, 8.f, HudPanel);
		Rect(CX - 200.f, 140.f, 400.f * Frac, 8.f, FLinearColor(1.f, 0.2f, 0.2f, 1.f));
	}
}

FVector2D ATSHUD::ToMinimap(const FVector& World) const
{
	const float U = (float)(World.Y / MapWidthCm) + 0.5f;
	const float V = 0.5f - (float)(World.X / MapHeightCm);
	return MinimapOrigin + FVector2D(U * MinimapSize.X, V * MinimapSize.Y);
}

void ATSHUD::DrawMinimap(ATSGameMode* M)
{
	const FTSMapGrid& G = M->World.Grid;
	if (!G.IsValid()) return;
	if (MinimapTexture == nullptr || MinimapFor != G.Def.Id)
	{
		const FTSVisualSettings& V = UTSGameSubsystem::Get(this)->Data().Game.Visuals;
		constexpr int32 Ppc = 4;
		const int32 TW = G.Width * Ppc, TH = G.Height * Ppc;
		TArray<FColor> Pixels;
		Pixels.SetNumZeroed(TW * TH);
		for (int32 Y = 0; Y < G.Height; ++Y)
			for (int32 X = 0; X < G.Width; ++X)
			{
				FLinearColor C;
				switch (G.Get(X, Y))
				{
				case ETSCellType::Wall: C = FLinearColor(0.f, 0.f, 0.f, 0.f); break;
				case ETSCellType::LowCover: C = UTSGameSubsystem::Color(V.LowCoverColor); break;
				case ETSCellType::HighCover: C = UTSGameSubsystem::Color(V.HighCoverColor); break;
				case ETSCellType::SiteA:
				case ETSCellType::SiteB: C = UTSGameSubsystem::Color(V.SiteColor) * 0.8f; break;
				case ETSCellType::AttackSpawn: C = UTSGameSubsystem::Color(V.AttackSpawnColor); break;
				case ETSCellType::DefenseSpawn: C = UTSGameSubsystem::Color(V.DefenseSpawnColor); break;
				default: C = FLinearColor(0.55f, 0.55f, 0.52f, 1.f); break;
				}
				const FColor C8 = C.ToFColor(true);
				for (int32 PY = 0; PY < Ppc; ++PY)
					for (int32 PX = 0; PX < Ppc; ++PX)
						Pixels[(Y * Ppc + PY) * TW + X * Ppc + PX] = C8;
			}
		MinimapTexture = UTexture2D::CreateTransient(TW, TH, PF_B8G8R8A8);
		MinimapTexture->Filter = TextureFilter::TF_Nearest;
		FTexture2DMipMap& Mip = MinimapTexture->GetPlatformData()->Mips[0];
		void* Data = Mip.BulkData.Lock(LOCK_READ_WRITE);
		FMemory::Memcpy(Data, Pixels.GetData(), Pixels.Num() * sizeof(FColor));
		Mip.BulkData.Unlock();
		MinimapTexture->UpdateResource();
		MinimapFor = G.Def.Id;
		MapWidthCm = G.WorldWidth() * 100.f;
		MapHeightCm = G.WorldHeight() * 100.f;
		const float Aspect = (float)G.Width / (float)G.Height;
		MinimapSize = Aspect >= 1.f ? FVector2D(290.f, 290.f / Aspect) : FVector2D(290.f * Aspect, 290.f);
		MinimapOrigin = FVector2D(25.f, 25.f);
	}
	Rect(20.f, 20.f, (float)MinimapSize.X + 10.f, (float)MinimapSize.Y + 10.f, HudPanel);
	DrawTexture(MinimapTexture, (float)MinimapOrigin.X * Scale, (float)MinimapOrigin.Y * Scale, (float)MinimapSize.X * Scale, (float)MinimapSize.Y * Scale, 0.f, 0.f, 1.f, 1.f);

	const FTSPlayerRecord* Local = M->LocalRecord();
	const float Now = GetWorld()->GetRealTimeSeconds();
	if (Now >= NextSpotTime)
	{
		NextSpotTime = Now + 0.1f;
		UpdateSpotted(M, Local->Team);
	}
	for (ATSCharacter* C : M->AliveCharacters())
	{
		const bool bEnemy = C->Team() != Local->Team;
		if (bEnemy && C->RevealedUntil <= M->MatchTime && !SpottedIds.Contains(C->Id())) continue;
		const FVector2D P = ToMinimap(C->Feet());
		const float Size = C->Record->bIsLocal ? 10.f : 7.f;
		const FLinearColor Col = C->Record->bIsLocal ? FLinearColor::White : bEnemy ? HudAccent : SideColor(M, C->Team());
		Rect((float)P.X - Size / 2.f, (float)P.Y - Size / 2.f, Size, Size, Col);
		const FVector2D Dir = FVector2D(FMath::Sin(FMath::DegreesToRadians(C->Yaw)), -FMath::Cos(FMath::DegreesToRadians(C->Yaw))) * 9.f;
		DrawLine((float)P.X * Scale, (float)P.Y * Scale, (float)(P.X + Dir.X) * Scale, (float)(P.Y + Dir.Y) * Scale, Col, 1.5f * Scale);
	}
	const FTSBombSystem& Bomb = M->Bomb;
	const bool bCarriedByMate = Bomb.State == ETSBombState::Carried && Bomb.Carrier && Bomb.Carrier->Team() == Local->Team;
	// Same visibility as the world marker: a dropped bomb is only shown to the attackers.
	const bool bDroppedForUs = Bomb.State == ETSBombState::Dropped && M->SideOf(*Local) == ETSSide::Attack;
	if (Bomb.State == ETSBombState::Planted || bDroppedForUs || bCarriedByMate)
	{
		const FVector2D P = ToMinimap(bCarriedByMate ? Bomb.Carrier->Feet() : Bomb.Position);
		Rect((float)P.X - 4.f, (float)P.Y - 12.f, 8.f, 8.f, UTSGameSubsystem::Color(UTSGameSubsystem::Get(this)->Data().Game.Visuals.BombColor));
	}
}

void ATSHUD::UpdateSpotted(ATSGameMode* M, ETSTeam Team)
{
	// An enemy shows on the map while a teammate within 60 m, looking within 60 degrees of
	// them, has line of sight (same rule as HudScreen.cs).
	SpottedIds.Reset();
	const TArray<ATSCharacter*> Alive = M->AliveCharacters();
	const float MinCos = FMath::Cos(FMath::DegreesToRadians(60.f));
	for (ATSCharacter* Enemy : Alive)
	{
		if (Enemy->Team() == Team) continue;
		for (ATSCharacter* Mate : Alive)
		{
			if (Mate->Team() != Team || FVector::DistSquared(Mate->Feet(), Enemy->Feet()) > FMath::Square(6000.0)) continue;
			const FVector ToEnemy = (Enemy->ChestPosition() - Mate->EyePosition()).GetSafeNormal();
			if (FVector::DotProduct(Mate->AimForward(), ToEnemy) < MinCos) continue;
			if (M->Combat.LineOfSight(Mate->EyePosition(), Enemy->ChestPosition()))
			{
				SpottedIds.Add(Enemy->Id());
				break;
			}
		}
	}
}

void ATSHUD::DrawKillfeed()
{
	const float Right = Canvas->ClipX / Scale - 20.f;
	float Y = 40.f;
	for (const FFeedEntry& F : Feed)
	{
		const float WK = F.Killer.IsEmpty() ? 0.f : LabelWidth(F.Killer, 19.f) + 10.f;
		const float WS = LabelWidth(F.Source, 19.f) + 10.f;
		const float WV = LabelWidth(F.Victim, 19.f);
		const float Total = WK + WS + WV + 20.f;
		Rect(Right - Total, Y, Total, 32.f, F.bLocal ? FLinearColor(0.6f, 0.1f, 0.15f, 0.7f) : HudPanel);
		float X = Right - Total + 10.f;
		if (!F.Killer.IsEmpty()) { Label(F.Killer, X, Y + 4.f, 19.f, F.KillerColor); X += WK; }
		Label(F.Source, X, Y + 4.f, 19.f, FLinearColor(0.78f, 0.78f, 0.78f, 1.f));
		X += WS;
		Label(F.Victim, X, Y + 4.f, 19.f, F.VictimColor);
		Y += 36.f;
	}
}

void ATSHUD::DrawVitals(ATSGameMode* M, ATSCharacter* S)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const float H = 1080.f, W = Canvas->ClipX / Scale;
	// bottom left: health and armour
	Rect(20.f, H - 130.f, 360.f, 110.f, HudPanel);
	Label(FString::FromInt(S->Health), 40.f, H - 122.f, 56.f, S->Health > 30 ? HudText : HudAccent, 0.f, true);
	if (S->Armor > 0) Label(FString::Printf(TEXT("ARMOR %d"), S->Armor), 180.f, H - 112.f, 24.f, FLinearColor(0.55f, 0.8f, 1.f, 1.f));
	Label(S->Record->Name + TEXT(" - ") + (S->Agent ? S->Agent->DisplayName : FString()), 180.f, H - 76.f, 18.f, HudDim);
	Rect(40.f, H - 38.f, 320.f, 6.f, FLinearColor(1.f, 1.f, 1.f, 0.15f));
	Rect(40.f, H - 38.f, 320.f * S->Health / (float)Game->Data().Game.Combat.MaxHealth, 6.f, HudGood);

	// bottom centre: abilities
	static const TCHAR* Actions[] = { TEXT("Ability1"), TEXT("Ability2"), TEXT("Ability3"), TEXT("Ultimate") };
	for (int32 i = 0; i < 4; ++i)
	{
		const FTSAgentAbilitySlot* Slot = S->Abilities.Slot(i);
		if (Slot == nullptr) continue;
		const FTSAbilityDef* Def = S->Abilities.Def(i);
		const float X = W / 2.f - 315.f + i * 160.f, Y = H - 104.f;
		const bool bReady = S->Abilities.IsReady(i);
		Rect(X, Y, 150.f, 84.f, Slot->IsUltimate() && bReady ? FLinearColor(1.f, 0.8f, 0.2f, 0.45f) : HudPanel);
		Label(TSKeyNames::Label(Game->Keys.Key(Actions[i])), X + 10.f, Y + 6.f, 20.f, HudWarn, 0.f, true);
		Label(Def ? Def->DisplayName : Slot->AbilityId, X + 75.f, Y + 32.f, 16.f, bReady ? HudText : HudDim, 0.5f);
		const int32 Charges = S->Abilities.Charges(i);
		const FString Info = Slot->IsUltimate() ? FString::Printf(TEXT("%d/%d"), S->Record->UltPoints, Slot->UltPoints)
			: FString::ChrN(Charges, TEXT('|')) + FString::ChrN(FMath::Max(0, Slot->MaxCharges - Charges), TEXT('.'));
		Label(Info, X + 75.f, Y + 58.f, 16.f, HudDim, 0.5f);
	}

	// bottom right: money, weapon, ammo
	Rect(W - 380.f, H - 170.f, 360.f, 150.f, HudPanel);
	Label(FString::Printf(TEXT("$%d"), S->Record->Money), W - 40.f, H - 162.f, 28.f, HudGood, 1.f, true);
	const FTSWeaponInstance& Cur = S->Weapons.Current();
	if (Cur.IsValid())
	{
		Label(Cur.Def->DisplayName.ToUpper(), W - 40.f, H - 120.f, 22.f, HudDim, 1.f);
		const FString Ammo = Cur.Def->MagazineSize <= 0 ? FString(TEXT("-")) : S->Weapons.IsReloading() ? FString(TEXT("RELOADING")) : FString::Printf(TEXT("%d / %d"), Cur.Mag, Cur.Reserve);
		Label(Ammo, W - 40.f, H - 86.f, 44.f, HudText, 1.f, true);
	}
}

void ATSHUD::DrawInteraction(ATSGameMode* M, ATSCharacter* Local)
{
	if (Local == nullptr || !Local->IsAlive()) return;
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSBombSystem& Bomb = M->Bomb;
	const float CX = Canvas->ClipX / Scale / 2.f;
	float Progress = 0.f;
	FString What;
	if (Bomb.Planter == Local && Bomb.PlantProgress > 0.f) { Progress = Bomb.PlantProgress; What = TEXT("PLANTING"); }
	else if (Bomb.Defuser == Local && Bomb.DefuseProgress > 0.f) { Progress = Bomb.DefuseProgress; What = TEXT("DEFUSING"); }
	if (Progress > 0.f)
	{
		Label(What, CX, 690.f, 22.f, HudText, 0.5f, true);
		Rect(CX - 210.f, 720.f, 420.f, 16.f, HudPanel);
		Rect(CX - 210.f, 720.f, 420.f * Progress, 16.f, HudWarn);
	}
	const FString Interact = TSKeyNames::Label(Game->Keys.Key(TEXT("Interact")));
	FString Hint;
	if (M->Flow.Phase == ETSMatchPhase::BuyPhase) Hint = FString::Printf(TEXT("Press %s to buy"), *TSKeyNames::Label(Game->Keys.Key(TEXT("BuyMenu"))));
	else if (Local->bCarryingBomb) Hint = M->World.SiteAt(Local->Feet()) >= 0 ? FString::Printf(TEXT("Hold %s to plant"), *Interact) : FString(TEXT("You carry the bomb - plant it on site A or B"));
	else if (Bomb.State == ETSBombState::Planted && Local->Side() == ETSSide::Defense &&
		FVector::DistSquared2D(Local->Feet(), Bomb.Position) <= FMath::Square(Game->Data().Game.Bomb.InteractRadius * 100.0))
		Hint = FString::Printf(TEXT("Hold %s to defuse%s"), *Interact, Local->Record->Loadout.bHasDefuseKit ? TEXT(" (kit)") : TEXT(""));
	else if (M->Effects.NearestPickup(Local->Feet(), 180.f) != INDEX_NONE) Hint = FString::Printf(TEXT("Press %s to pick up the weapon"), *Interact);
	Label(Hint, CX, 1080.f - 150.f, 20.f, HudDim, 0.5f);
}

void ATSHUD::DrawBanner()
{
	if (GetWorld()->GetRealTimeSeconds() > BannerUntil) return;
	const float CX = Canvas->ClipX / Scale / 2.f;
	float Y = 260.f;
	for (const FString& Line : Lines(BannerText))
	{
		Label(Line, CX, Y, Y == 260.f ? 52.f : 30.f, HudText, 0.5f, true);
		Y += Y == 260.f ? 64.f : 40.f;
	}
}

void ATSHUD::DrawWorldMarkers(ATSGameMode* M, ATSCharacter* View)
{
	APlayerController* PC = GetOwningPlayerController();
	if (PC == nullptr || PC->PlayerCameraManager == nullptr) return;
	const FVector CamLoc = PC->PlayerCameraManager->GetCameraLocation();
	const FVector CamFwd = PC->PlayerCameraManager->GetCameraRotation().Vector();
	auto Marker = [&](const FVector& World, const FString& Text, const FLinearColor& Color, float Size, bool bClamp)
	{
		const bool bBehind = FVector::DotProduct(World - CamLoc, CamFwd) < 0.0;
		if (bBehind && !bClamp) return;
		FVector Screen = Canvas->Project(World);
		float X = (float)Screen.X / Scale, Y = (float)Screen.Y / Scale;
		if (bBehind) { X = Canvas->ClipX / Scale - X; Y = 1040.f; }
		if (bClamp)
		{
			X = FMath::Clamp(X, 40.f, Canvas->ClipX / Scale - 40.f);
			Y = FMath::Clamp(Y, 40.f, 1040.f);
		}
		Label(Text, X, Y - Size / 2.f, Size, Color, 0.5f, true);
	};
	const FTSVisualSettings& V = UTSGameSubsystem::Get(this)->Data().Game.Visuals;
	for (int32 Site = 0; Site < 2; ++Site)
		if (M->World.HasSite(Site)) Marker(M->World.SiteCenter(Site) + FVector(0.f, 0.f, 300.f), TSIds::SiteName(Site), UTSGameSubsystem::Color(V.SiteColor), 30.f, true);
	const FTSPlayerRecord* Local = M->LocalRecord();
	const FTSBombSystem& Bomb = M->Bomb;
	if (Bomb.State == ETSBombState::Planted || (Bomb.State == ETSBombState::Dropped && M->SideOf(*Local) == ETSSide::Attack))
		Marker(Bomb.Position + FVector(0.f, 0.f, 80.f), TEXT("BOMB"), UTSGameSubsystem::Color(V.BombColor), 18.f, true);
	for (ATSCharacter* C : M->AliveCharacters())
	{
		if (C == View) continue;
		const bool bEnemy = C->Team() != Local->Team;
		if (bEnemy && C->RevealedUntil <= M->MatchTime) continue;
		if (!bEnemy && FVector::DistSquared(C->Feet(), CamLoc) > FMath::Square(6000.0)) continue;
		Marker(C->Feet() + FVector(0.f, 0.f, C->HeightMetres() * 100.f + 35.f), bEnemy ? FString(TEXT("[ ! ]")) : C->Record->Name,
			bEnemy ? HudAccent : FLinearColor(0.7f, 0.9f, 1.f, 1.f), 16.f, bEnemy);
	}
}

void ATSHUD::DrawScoreboard(ATSGameMode* M)
{
	const FTSPlayerRecord* Local = M->LocalRecord();
	if (Local == nullptr) return;
	const FTSGameData& D = UTSGameSubsystem::Get(this)->Data();
	const float W = 1200.f, X0 = Canvas->ClipX / Scale / 2.f - W / 2.f;
	float Y = 170.f;
	Rect(X0, Y, W, 740.f, FLinearColor(0.05f, 0.07f, 0.09f, 0.92f));
	Label(FString::Printf(TEXT("%s  -  ROUND %d  -  FIRST TO %d%s"), *M->World.Grid.Def.DisplayName, M->Flow.Round, M->Options.RoundsToWin,
		M->Flow.bInOvertime ? TEXT("  -  OVERTIME") : TEXT("")), X0 + W / 2.f, Y + 14.f, 20.f, HudDim, 0.5f);
	Y += 50.f;
	static const float Columns[] = { 0.f, 330.f, 500.f, 580.f, 660.f, 740.f, 860.f, 1000.f };
	static const TCHAR* Titles[] = { TEXT("PLAYER"), TEXT("AGENT"), TEXT("K"), TEXT("D"), TEXT("A"), TEXT("SCORE"), TEXT("MONEY"), TEXT("ULT") };
	for (ETSTeam Team : { Local->Team, TSIds::Other(Local->Team) })
	{
		const ETSSide Side = M->Flow.SideOf(Team);
		Label(FString::Printf(TEXT("%s  -  %s  -  %d"), Team == Local->Team ? TEXT("YOUR TEAM") : TEXT("ENEMY TEAM"),
			Side == ETSSide::Attack ? TEXT("ATTACK") : TEXT("DEFENSE"), M->Flow.Score[TSIds::Index(Team)]), X0 + 30.f, Y, 26.f, SideColor(M, Team), 0.f, true);
		Y += 40.f;
		for (int32 c = 0; c < 8; ++c) Label(Titles[c], X0 + 30.f + Columns[c], Y, 16.f, HudDim);
		Y += 26.f;
		TArray<const FTSPlayerRecord*> Rows;
		for (const FTSPlayerRecord& P : M->Players) if (P.Team == Team) Rows.Add(&P);
		Rows.Sort([](const FTSPlayerRecord& A, const FTSPlayerRecord& B) { return A.Score != B.Score ? A.Score > B.Score : A.Kills > B.Kills; });
		for (const FTSPlayerRecord* P : Rows)
		{
			Rect(X0 + 20.f, Y - 4.f, W - 40.f, 36.f, P->bIsLocal ? FLinearColor(1.f, 0.28f, 0.34f, 0.18f) : FLinearColor(1.f, 1.f, 1.f, 0.05f));
			const FLinearColor C = P->bAlive || M->Flow.Phase != ETSMatchPhase::Live ? HudText : FLinearColor(0.5f, 0.5f, 0.5f, 1.f);
			const FTSAgentDef* Agent = D.Agent(P->AgentId);
			const int32 Ult = FTSPlayerRecord::UltCost(Agent);
			const FString Cells[] = {
				(P->bIsLocal ? TEXT("> ") : TEXT("")) + P->Name + (P->bIsBot ? TEXT("  BOT") : TEXT("")),
				Agent ? Agent->DisplayName : P->AgentId, FString::FromInt(P->Kills), FString::FromInt(P->Deaths), FString::FromInt(P->Assists),
				FString::FromInt(P->Score), Team == Local->Team ? FString::Printf(TEXT("$%d"), P->Money) : FString(),
				Ult > 0 ? FString::Printf(TEXT("%d/%d"), P->UltPoints, Ult) : FString(TEXT("-")) };
			for (int32 c = 0; c < 8; ++c) Label(Cells[c], X0 + 30.f + Columns[c], Y, 19.f, C);
			Y += 40.f;
		}
		Y += 20.f;
	}
}
