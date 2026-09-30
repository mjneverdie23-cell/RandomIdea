#include "TSSynth.h"
#include "TSRng.h"

TArray<float> TSSynth::Generate(const FTSAudioCue& Cue, int32 SampleRate)
{
	TArray<float> Samples;
	const int32 N = (int32)FMath::FloorToDouble((double)Cue.Duration * (double)SampleRate + 0.5);
	if (N <= 0 || Cue.Duration <= 0.f) return Samples;
	Samples.SetNumUninitialized(N);
	FTSRng Rng(TSFnv1a(Cue.Id));
	const ETSWave Wave = TSIds::ParseWave(Cue.Wave);
	const double F0 = Cue.Frequency, F1 = Cue.FrequencyEnd;
	const double Mix = Wave == ETSWave::Noise ? 1.0 : (double)Cue.Noise;
	const double Attack = FMath::Max((double)Cue.Attack, 1e-4);
	const double Duration = Cue.Duration;
	double Phase = 0.0;
	for (int32 i = 0; i < N; ++i)
	{
		const double T = (double)i / (double)SampleRate;
		const double U = T / Duration;
		const double F = (F1 > 0.0 && F0 > 0.0) ? F0 * FMath::Pow(F1 / F0, U) : F0;
		Phase += F / (double)SampleRate;
		Phase -= FMath::FloorToDouble(Phase);
		double Osc;
		switch (Wave)
		{
		case ETSWave::Sine: Osc = FMath::Sin(2.0 * UE_DOUBLE_PI * Phase); break;
		case ETSWave::Square: Osc = Phase < 0.5 ? 1.0 : -1.0; break;
		case ETSWave::Saw: Osc = 2.0 * Phase - 1.0; break;
		case ETSWave::Triangle: Osc = 1.0 - 4.0 * FMath::Abs(Phase - 0.5); break;
		default: Osc = 0.0; break;
		}
		const double Noise = (double)Rng.NextFloat() * 2.0 - 1.0;
		const double Env = FMath::Min(1.0, T / Attack) * FMath::Pow(FMath::Max(0.0, 1.0 - U), (double)Cue.Decay);
		Samples[i] = (float)((Osc * (1.0 - Mix) + Noise * Mix) * Env * (double)Cue.Volume);
	}
	return Samples;
}

TArray<uint8> TSSynth::ToPcm16(const TArray<float>& Samples)
{
	TArray<uint8> Bytes;
	Bytes.SetNumUninitialized(Samples.Num() * 2);
	for (int32 i = 0; i < Samples.Num(); ++i)
	{
		const int16 V = (int16)FMath::Clamp(FMath::RoundToInt(Samples[i] * 32767.f), -32768, 32767);
		Bytes[2 * i] = (uint8)(V & 0xFF);
		Bytes[2 * i + 1] = (uint8)((V >> 8) & 0xFF);
	}
	return Bytes;
}
