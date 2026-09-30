#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Core/TSGameData.h"
#include "Core/TSKeyNames.h"
#include "Game/TSTypes.h"
#include "TSGameSubsystem.generated.h"

class UStaticMesh;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UStaticMeshComponent;

/**
 * Lives for the whole session: loads the JSON data (Content/Data), the player's settings
 * (Saved/TacticalShooter/settings.json), synthesises the placeholder sounds and caches the
 * basic-shape meshes and colour materials every actor uses. Mirrors GameBootstrap/Game in Unity.
 */
UCLASS()
class TACTICALSHOOTER_API UTSGameSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	static UTSGameSubsystem* Get(const UObject* WorldContext);

	const FTSGameData& Data() const { return GameData; }

	FTSUserSettings Settings;
	FTSKeyMap Keys;

	void SaveSettings() const;
	/** Applies video settings (window mode, vsync, frame cap, scalability). */
	void ApplySettings() const;
	void RebuildKeyMap() { Keys = FTSKeyMap(GameData.Input, Settings.KeyOverrides); }
	/** Stores a key override. Overrides always carry both keys. */
	void SetKey(const FString& Action, const FString& Key, bool bAlt);
	/** Restores shared/config/settings.json defaults, keeping the match setup choices. */
	void ResetSettingsKeepSetup();

	/** Mono 16-bit PCM for a cue, or nullptr. */
	const TArray<uint8>* Pcm(const FString& CueId) const { return PcmByCue.Find(CueId); }
	int32 SampleRate() const { return FMath::Max(8000, GameData.Audio.SampleRate); }

	UStaticMesh* Mesh(ETSShape Shape) const;
	UMaterialInterface* Material(const FLinearColor& InColor);
	static FLinearColor Color(const FString& Hex);

	/** Adds a visual-only (or colliding) basic shape to an actor. Location in cm, scale in metres (shapes are 1 m). */
	UStaticMeshComponent* AddShape(AActor* Owner, USceneComponent* Parent, ETSShape Shape, const FVector& Location, const FVector& Scale,
		const FLinearColor& Color, bool bCollision = false, FName Name = NAME_None);

	/** Full path of a file in Content/Data ("Config/game" -> .../Content/Data/Config/game.json). */
	static FString DataPath(const FString& Key);

private:
	FTSGameData GameData;
	TMap<FString, TArray<uint8>> PcmByCue;

	UPROPERTY() TObjectPtr<UStaticMesh> CubeMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> SphereMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> CylinderMesh;
	UPROPERTY() TObjectPtr<UMaterialInterface> BaseMaterial;
	UPROPERTY() TMap<uint32, TObjectPtr<UMaterialInstanceDynamic>> Materials;

	static FString SettingsPath();
};
