#pragma once

#include "CoreMinimal.h"

/**
 * xorshift32, identical to Rng in the Unity core and reference_rules.py (GAME_RULES.md 13),
 * so seeded behaviour matches across engines.
 */
struct FTSRng
{
	uint32 State;

	explicit FTSRng(uint32 Seed = 0) : State(Seed == 0 ? 0x9E3779B9u : Seed) {}

	uint32 NextUInt()
	{
		uint32 S = State;
		S ^= S << 13;
		S ^= S >> 17;
		S ^= S << 5;
		State = S;
		return S;
	}

	/** Uniform in [0, 1). */
	float NextFloat() { return (float)(NextUInt() >> 8) / 16777216.f; }

	float Range(float Min, float Max) { return Min + (Max - Min) * NextFloat(); }

	/** Uniform integer in [MinInclusive, MaxExclusive). */
	int32 RangeInt(int32 MinInclusive, int32 MaxExclusive)
	{
		if (MaxExclusive <= MinInclusive) return MinInclusive;
		const int32 V = MinInclusive + (int32)(NextFloat() * (float)(MaxExclusive - MinInclusive));
		return V >= MaxExclusive ? MaxExclusive - 1 : V;
	}

	bool Chance(float Probability) { return NextFloat() < Probability; }

	template <typename T>
	void Shuffle(TArray<T>& Items)
	{
		for (int32 i = Items.Num() - 1; i > 0; --i)
		{
			const int32 j = RangeInt(0, i + 1);
			if (i != j) Items.Swap(i, j);
		}
	}
};

/** 32-bit FNV-1a over the UTF-8 bytes of a string. */
inline uint32 TSFnv1a(const FString& Text)
{
	uint32 H = 2166136261u;
	FTCHARToUTF8 Utf8(*Text);
	const uint8* Bytes = (const uint8*)Utf8.Get();
	for (int32 i = 0; i < Utf8.Length(); ++i)
	{
		H ^= Bytes[i];
		H *= 16777619u;
	}
	return H;
}
