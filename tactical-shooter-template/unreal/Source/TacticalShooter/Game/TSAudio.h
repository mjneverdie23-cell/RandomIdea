#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TSAudio.generated.h"

class UAudioComponent;
class USoundWaveProcedural;

/**
 * Plays the cues from shared/config/audio.json. Every cue is synthesised at startup
 * (TSSynth, GAME_RULES.md 14) and queued on a small pool of procedural voices: spatial voices
 * that move to where a sound happens, plus 2D voices for UI and announcements.
 * To use real assets instead, replace Play() with UGameplayStatics::PlaySoundAtLocation.
 */
UCLASS()
class TACTICALSHOOTER_API ATSAudioHost : public AActor
{
	GENERATED_BODY()

public:
	ATSAudioHost();
	virtual void BeginPlay() override;

	void Play(const FString& CueId, const FVector& Location, float Volume = 1.f);
	void Play2D(const FString& CueId, float Volume = 1.f);

private:
	struct FVoice
	{
		UAudioComponent* Component = nullptr;
		USoundWaveProcedural* Wave = nullptr;
		float BusyUntil = 0.f;
	};

	FVoice MakeVoice(bool bSpatial, int32 Index);
	void Queue(FVoice& Voice, const TArray<uint8>& Pcm, float Volume);

	TArray<FVoice> Spatial;
	TArray<FVoice> Flat;
	int32 NextSpatial = 0;
	int32 NextFlat = 0;

	UPROPERTY() TArray<TObjectPtr<UAudioComponent>> Components;
	UPROPERTY() TArray<TObjectPtr<USoundWaveProcedural>> Waves;
};
