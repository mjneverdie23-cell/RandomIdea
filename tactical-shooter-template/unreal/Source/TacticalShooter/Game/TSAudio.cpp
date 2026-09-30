#include "Game/TSAudio.h"
#include "Game/TSGameSubsystem.h"
#include "Components/AudioComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundWaveProcedural.h"

namespace
{
	constexpr int32 SpatialVoices = 24;
	constexpr int32 FlatVoices = 3;
}

ATSAudioHost::ATSAudioHost()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void ATSAudioHost::BeginPlay()
{
	Super::BeginPlay();
	for (int32 i = 0; i < SpatialVoices; ++i) Spatial.Add(MakeVoice(true, i));
	for (int32 i = 0; i < FlatVoices; ++i) Flat.Add(MakeVoice(false, i));
}

ATSAudioHost::FVoice ATSAudioHost::MakeVoice(bool bSpatial, int32 Index)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	FVoice V;
	V.Wave = NewObject<USoundWaveProcedural>(this);
	V.Wave->SetSampleRate(Game->SampleRate());
	V.Wave->NumChannels = 1;
	V.Wave->Duration = INDEFINITELY_LOOPING_DURATION;
	V.Wave->SoundGroup = SOUNDGROUP_Default;
	V.Wave->bLooping = false;

	V.Component = NewObject<UAudioComponent>(this, *FString::Printf(TEXT("Voice%s%d"), bSpatial ? TEXT("3D") : TEXT("2D"), Index));
	V.Component->bAutoActivate = false;
	V.Component->bAutoDestroy = false;
	V.Component->bAllowSpatialization = bSpatial;
	V.Component->bIsUISound = !bSpatial;
	if (bSpatial)
	{
		V.Component->bOverrideAttenuation = true;
		V.Component->AttenuationOverrides.bAttenuate = true;
		V.Component->AttenuationOverrides.bSpatialize = true;
		V.Component->AttenuationOverrides.AttenuationShape = EAttenuationShape::Sphere;
		V.Component->AttenuationOverrides.AttenuationShapeExtents = FVector(200.f, 0.f, 0.f);
		V.Component->AttenuationOverrides.FalloffDistance = 5000.f;
	}
	V.Component->SetupAttachment(RootComponent);
	V.Component->RegisterComponent();
	V.Component->SetSound(V.Wave);
	Components.Add(V.Component);
	Waves.Add(V.Wave);
	return V;
}

void ATSAudioHost::Queue(FVoice& Voice, const TArray<uint8>& Pcm, float Volume)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const float Now = GetWorld()->GetRealTimeSeconds();
	// A voice still playing something is reset rather than queued behind, so sounds stay on time.
	if (Voice.BusyUntil > Now) Voice.Wave->ResetAudio();
	Voice.Wave->QueueAudio(Pcm.GetData(), Pcm.Num());
	Voice.BusyUntil = Now + (float)Pcm.Num() / 2.f / (float)Game->SampleRate();
	Voice.Component->SetVolumeMultiplier(FMath::Clamp(Volume * Game->Settings.MasterVolume, 0.f, 4.f));
	if (!Voice.Component->IsPlaying()) Voice.Component->Play();
}

void ATSAudioHost::Play(const FString& CueId, const FVector& Location, float Volume)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSAudioCue* Cue = Game ? Game->Data().Cue(CueId) : nullptr;
	const TArray<uint8>* Pcm = Game ? Game->Pcm(CueId) : nullptr;
	if (Cue == nullptr || Pcm == nullptr || Spatial.Num() == 0) return;
	if (!Cue->Spatial)
	{
		Play2D(CueId, Volume);
		return;
	}
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
	{
		FVector ListenerPos;
		FRotator ListenerRot;
		PC->GetPlayerViewPoint(ListenerPos, ListenerRot);
		if (FVector::DistSquared(ListenerPos, Location) > FMath::Square((double)Cue->Range * 100.0)) return;
	}
	// Prefer an idle voice; otherwise take the next one round-robin.
	const float Now = GetWorld()->GetRealTimeSeconds();
	int32 Index = INDEX_NONE;
	for (int32 i = 0; i < Spatial.Num(); ++i)
		if (Spatial[(NextSpatial + i) % Spatial.Num()].BusyUntil <= Now) { Index = (NextSpatial + i) % Spatial.Num(); break; }
	if (Index == INDEX_NONE) Index = NextSpatial;
	NextSpatial = (Index + 1) % Spatial.Num();
	FVoice& V = Spatial[Index];
	V.Component->AttenuationOverrides.FalloffDistance = Cue->Range * 100.f;
	V.Component->SetWorldLocation(Location);
	Queue(V, *Pcm, Volume);
}

void ATSAudioHost::Play2D(const FString& CueId, float Volume)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const TArray<uint8>* Pcm = Game ? Game->Pcm(CueId) : nullptr;
	if (Pcm == nullptr || Flat.Num() == 0) return;
	FVoice& V = Flat[NextFlat];
	NextFlat = (NextFlat + 1) % Flat.Num();
	Queue(V, *Pcm, Volume);
}
