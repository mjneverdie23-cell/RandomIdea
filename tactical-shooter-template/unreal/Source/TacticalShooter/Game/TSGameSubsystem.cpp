#include "Game/TSGameSubsystem.h"
#include "TacticalShooter.h"
#include "Core/TSSynth.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "GameFramework/GameUserSettings.h"
#include "HAL/FileManager.h"
#include "JsonObjectConverter.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

void UTSGameSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	GameData = FTSGameData::Load([](const FString& Key, FString& OutText)
	{
		return FFileHelper::LoadFileToString(OutText, *DataPath(Key));
	});
	for (const FString& Error : GameData.Validate())
		UE_LOG(LogTacticalShooter, Warning, TEXT("config: %s"), *Error);

	Settings = GameData.DefaultSettings;
	FString Saved;
	if (FFileHelper::LoadFileToString(Saved, *SettingsPath()))
	{
		// Only the keys present in the file overwrite the defaults.
		if (!FJsonObjectConverter::JsonObjectStringToUStruct(Saved, &Settings, 0, 0))
			UE_LOG(LogTacticalShooter, Warning, TEXT("could not read %s, using defaults"), *SettingsPath());
	}
	RebuildKeyMap();

	const int32 Rate = SampleRate();
	for (const FTSAudioCue& Cue : GameData.Audio.Cues)
		PcmByCue.Add(Cue.Id, TSSynth::ToPcm16(TSSynth::Generate(Cue, Rate)));

	CubeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	SphereMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	CylinderMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	BaseMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	if (!CubeMesh || !BaseMaterial)
		UE_LOG(LogTacticalShooter, Error, TEXT("Could not load /Engine/BasicShapes. Is the engine content installed?"));

	UE_LOG(LogTacticalShooter, Log, TEXT("Loaded %d weapons, %d agents, %d abilities, %d map(s), %d sounds."),
		GameData.Weapons.Num(), GameData.Agents.Num(), GameData.Abilities.Num(), GameData.Maps.Num(), PcmByCue.Num());
}

void UTSGameSubsystem::Deinitialize()
{
	SaveSettings();
	Super::Deinitialize();
}

UTSGameSubsystem* UTSGameSubsystem::Get(const UObject* WorldContext)
{
	const UWorld* World = WorldContext ? WorldContext->GetWorld() : nullptr;
	const UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
	return GameInstance ? GameInstance->GetSubsystem<UTSGameSubsystem>() : nullptr;
}

FString UTSGameSubsystem::DataPath(const FString& Key)
{
	return FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Data"), Key + TEXT(".json"));
}

FString UTSGameSubsystem::SettingsPath()
{
	return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("TacticalShooter"), TEXT("settings.json"));
}

void UTSGameSubsystem::SaveSettings() const
{
	FString Json;
	if (!FJsonObjectConverter::UStructToJsonObjectString(Settings, Json)) return;
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(SettingsPath()), true);
	FFileHelper::SaveStringToFile(Json, *SettingsPath());
}

void UTSGameSubsystem::ApplySettings() const
{
	UGameUserSettings* User = GEngine ? GEngine->GetGameUserSettings() : nullptr;
	if (User == nullptr) return;
	User->SetVSyncEnabled(Settings.Vsync);
	User->SetFrameRateLimit(Settings.FpsLimit > 0 ? (float)Settings.FpsLimit : 0.f);
	if (Settings.QualityLevel >= 0) User->SetOverallScalabilityLevel(FMath::Clamp(Settings.QualityLevel, 0, 4));
#if !WITH_EDITOR
	User->SetFullscreenMode(Settings.Fullscreen ? EWindowMode::WindowedFullscreen : EWindowMode::Windowed);
#endif
	User->ApplySettings(false);
}

void UTSGameSubsystem::SetKey(const FString& Action, const FString& Key, bool bAlt)
{
	FTSKeyBinding* Entry = nullptr;
	for (FTSKeyBinding& O : Settings.KeyOverrides)
		if (O.Action == Action) Entry = &O;
	if (Entry == nullptr)
	{
		FTSKeyBinding New;
		New.Action = Action;
		New.Key = Keys.Key(Action);
		New.AltKey = Keys.AltKey(Action);
		Entry = &Settings.KeyOverrides[Settings.KeyOverrides.Add(New)];
	}
	if (bAlt) Entry->AltKey = Key;
	else Entry->Key = Key;
	RebuildKeyMap();
}

void UTSGameSubsystem::ResetSettingsKeepSetup()
{
	const FTSUserSettings Keep = Settings;
	Settings = GameData.DefaultSettings;
	Settings.AgentId = Keep.AgentId;
	Settings.PlayerSide = Keep.PlayerSide;
	Settings.BotDifficulty = Keep.BotDifficulty;
	Settings.TeamSize = Keep.TeamSize;
	Settings.RoundsToWin = Keep.RoundsToWin;
	Settings.MapId = Keep.MapId;
	RebuildKeyMap();
	ApplySettings();
}

UStaticMesh* UTSGameSubsystem::Mesh(ETSShape Shape) const
{
	switch (Shape)
	{
	case ETSShape::Sphere: return SphereMesh;
	case ETSShape::Cylinder: return CylinderMesh;
	default: return CubeMesh;
	}
}

FLinearColor UTSGameSubsystem::Color(const FString& Hex)
{
	const FColor C = FColor::FromHex(Hex);
	return FLinearColor::FromSRGBColor(C);
}

UMaterialInterface* UTSGameSubsystem::Material(const FLinearColor& InColor)
{
	const uint32 Key = GetTypeHash(InColor.ToFColor(true).ToPackedARGB());
	if (TObjectPtr<UMaterialInstanceDynamic>* Found = Materials.Find(Key))
		return Found->Get();
	if (BaseMaterial == nullptr) return nullptr;
	UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(BaseMaterial, this);
	// BasicShapeMaterial exposes a "Color" vector parameter.
	Mid->SetVectorParameterValue(TEXT("Color"), InColor);
	Materials.Add(Key, Mid);
	return Mid;
}

UStaticMeshComponent* UTSGameSubsystem::AddShape(AActor* Owner, USceneComponent* Parent, ETSShape Shape, const FVector& Location,
	const FVector& Scale, const FLinearColor& InColor, bool bCollision, FName Name)
{
	UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(Owner, Name);
	C->SetStaticMesh(Mesh(Shape));
	C->SetMaterial(0, Material(InColor));
	C->SetMobility(EComponentMobility::Movable);
	C->SetCollisionEnabled(bCollision ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
	if (bCollision)
	{
		C->SetCollisionObjectType(ECC_WorldStatic);
		C->SetCollisionResponseToAllChannels(ECR_Block);
	}
	C->SetGenerateOverlapEvents(false);
	if (Parent != nullptr) C->SetupAttachment(Parent);
	C->SetRelativeLocation(Location);
	C->SetRelativeScale3D(Scale);
	C->RegisterComponent();
	Owner->AddInstanceComponent(C);
	return C;
}
