#pragma once

#include "CoreMinimal.h"
#include "TSConfigTypes.h"

/**
 * Placeholder sound generator (GAME_RULES.md section 14), identical to Synth.cs in the Unity
 * project. Every cue in audio.json is synthesised at startup, so the template ships with sound
 * and no audio assets.
 */
namespace TSSynth
{
	TACTICALSHOOTER_API TArray<float> Generate(const FTSAudioCue& Cue, int32 SampleRate);

	/** Mono 16-bit little-endian PCM, the format USoundWaveProcedural::QueueAudio expects. */
	TACTICALSHOOTER_API TArray<uint8> ToPcm16(const TArray<float>& Samples);
}
