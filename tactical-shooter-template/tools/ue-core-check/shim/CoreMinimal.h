// Minimal stand-in for Unreal's CoreMinimal.h, just enough to compile the engine-free part of
// unreal/Source/TacticalShooter/Core with a plain C++17 compiler. It mimics Unreal semantics
// where they matter (FString == is case-insensitive, FMath::Min/Max need matching types,
// TArray bounds are checked). It is a test harness only; the real engine never sees it.
#pragma once

#include <algorithm>
#include <cassert>
#include <cctype>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <initializer_list>
#include <limits>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

typedef int8_t int8;
typedef uint8_t uint8;
typedef int16_t int16;
typedef uint16_t uint16;
typedef int32_t int32;
typedef uint32_t uint32;
typedef int64_t int64;
typedef uint64_t uint64;
typedef char TCHAR;

#define TEXT(x) x
#define USTRUCT(...)
#define UPROPERTY(...)
#define UENUM(...)
#define UMETA(...)
#define GENERATED_BODY()
#define TACTICALSHOOTER_API
#define INDEX_NONE (-1)
#define UE_PI 3.1415926535897932f
#define UE_DOUBLE_PI 3.141592653589793238462643383279502884197169399
#define check(x) assert(x)
#define MoveTemp(x) std::move(x)

template <typename T>
struct TNumericLimits
{
	static constexpr T Max() { return std::numeric_limits<T>::max(); }
	static constexpr T Lowest() { return std::numeric_limits<T>::lowest(); }
};

namespace ESearchCase
{
	enum Type { CaseSensitive, IgnoreCase };
}

template <typename T>
class TArray
{
	struct FSlot { T V; };
	std::vector<FSlot> Data;

	void CheckIndex(int32 I) const
	{
		if (I < 0 || I >= Num())
		{
			std::fprintf(stderr, "TArray index %d out of bounds (Num %d)\n", I, Num());
			std::abort();
		}
	}

public:
	template <typename SlotT, typename ValueT>
	struct TIt
	{
		SlotT* P;
		ValueT& operator*() const { return P->V; }
		ValueT* operator->() const { return &P->V; }
		TIt& operator++() { ++P; return *this; }
		bool operator!=(const TIt& O) const { return P != O.P; }
	};

	TArray() {}
	TArray(std::initializer_list<T> L) { for (const T& X : L) Add(X); }

	int32 Num() const { return (int32)Data.size(); }
	bool IsEmpty() const { return Data.empty(); }
	bool IsValidIndex(int32 I) const { return I >= 0 && I < Num(); }
	int32 Add(const T& X) { Data.push_back(FSlot{ X }); return Num() - 1; }
	int32 Add(T&& X) { Data.push_back(FSlot{ std::move(X) }); return Num() - 1; }
	template <typename... A> int32 Emplace(A&&... Args) { Data.push_back(FSlot{ T(std::forward<A>(Args)...) }); return Num() - 1; }
	void Append(const TArray& O) { for (const T& X : O) Add(X); }
	T& operator[](int32 I) { CheckIndex(I); return Data[I].V; }
	const T& operator[](int32 I) const { CheckIndex(I); return Data[I].V; }
	T& Last() { CheckIndex(Num() - 1); return Data.back().V; }
	const T& Last() const { CheckIndex(Num() - 1); return Data.back().V; }
	T Pop() { CheckIndex(Num() - 1); T X = std::move(Data.back().V); Data.pop_back(); return X; }
	void Reset() { Data.clear(); }
	void Empty() { Data.clear(); }
	void Reserve(int32 N) { Data.reserve(N); }
	void RemoveAt(int32 I) { CheckIndex(I); Data.erase(Data.begin() + I); }
	void Insert(const T& X, int32 I) { Data.insert(Data.begin() + I, FSlot{ X }); }
	void SetNum(int32 N) { Data.resize(N); }
	void SetNumUninitialized(int32 N) { Data.resize(N); }
	void SetNumZeroed(int32 N) { Data.assign(N, FSlot{ T() }); }
	void Init(const T& Value, int32 N) { Data.assign(N, FSlot{ Value }); }
	void Swap(int32 A, int32 B) { CheckIndex(A); CheckIndex(B); std::swap(Data[A].V, Data[B].V); }
	bool Contains(const T& X) const { for (const FSlot& S : Data) if (S.V == X) return true; return false; }
	int32 IndexOfByKey(const T& X) const { for (int32 I = 0; I < Num(); ++I) if (Data[I].V == X) return I; return INDEX_NONE; }
	template <typename P> bool ContainsByPredicate(P Pred) const { for (const FSlot& S : Data) if (Pred(S.V)) return true; return false; }
	template <typename P> void Sort(P Pred) { std::sort(Data.begin(), Data.end(), [&](const FSlot& A, const FSlot& B) { return Pred(A.V, B.V); }); }
	template <typename P> void StableSort(P Pred) { std::stable_sort(Data.begin(), Data.end(), [&](const FSlot& A, const FSlot& B) { return Pred(A.V, B.V); }); }

	TIt<FSlot, T> begin() { return TIt<FSlot, T>{ Data.data() }; }
	TIt<FSlot, T> end() { return TIt<FSlot, T>{ Data.data() + Data.size() }; }
	TIt<const FSlot, const T> begin() const { return TIt<const FSlot, const T>{ Data.data() }; }
	TIt<const FSlot, const T> end() const { return TIt<const FSlot, const T>{ Data.data() + Data.size() }; }
};

class FString
{
	std::string S;

public:
	FString() {}
	FString(const char* In) : S(In ? In : "") {}
	FString(const std::string& In) : S(In) {}

	int32 Len() const { return (int32)S.size(); }
	bool IsEmpty() const { return S.empty(); }
	void Empty() { S.clear(); }
	const char* operator*() const { return S.c_str(); }
	char operator[](int32 I) const { assert(I >= 0 && I < Len()); return S[I]; }
	const std::string& Std() const { return S; }

	bool Equals(const FString& O, ESearchCase::Type Case = ESearchCase::CaseSensitive) const
	{
		if (Case == ESearchCase::CaseSensitive) return S == O.S;
		if (S.size() != O.S.size()) return false;
		for (size_t I = 0; I < S.size(); ++I)
			if (std::tolower((unsigned char)S[I]) != std::tolower((unsigned char)O.S[I])) return false;
		return true;
	}
	// Unreal's FString operator== ignores case; the shim does too so tests catch reliance on case.
	friend bool operator==(const FString& A, const FString& B) { return A.Equals(B, ESearchCase::IgnoreCase); }
	friend bool operator!=(const FString& A, const FString& B) { return !(A == B); }
	friend bool operator==(const FString& A, const char* B) { return A == FString(B); }
	friend bool operator!=(const FString& A, const char* B) { return !(A == FString(B)); }
	friend FString operator+(const FString& A, const FString& B) { return FString(A.S + B.S); }
	friend FString operator+(const FString& A, const char* B) { return FString(A.S + B); }
	friend FString operator+(const char* A, const FString& B) { return FString(std::string(A) + B.S); }
	FString& operator+=(const FString& O) { S += O.S; return *this; }
	FString& operator+=(const char* O) { S += O; return *this; }

	FString ToLower() const { std::string R = S; for (char& C : R) C = (char)std::tolower((unsigned char)C); return FString(R); }
	static FString FromInt(int32 V) { return FString(std::to_string(V)); }
	static FString Chr(char C) { return FString(std::string(1, C)); }
	static FString Printf(const char* Fmt, ...)
	{
		char Buffer[4096];
		va_list Args;
		va_start(Args, Fmt);
		std::vsnprintf(Buffer, sizeof(Buffer), Fmt, Args);
		va_end(Args);
		return FString(Buffer);
	}
};

struct FCString
{
	static int32 Atoi(const char* S) { return std::atoi(S); }
};

class FTCHARToUTF8
{
	std::string S;

public:
	explicit FTCHARToUTF8(const char* In) : S(In ? In : "") {}
	const char* Get() const { return S.c_str(); }
	int32 Length() const { return (int32)S.size(); }
};

struct FMath
{
	template <typename T> static T Min(T A, T B) { return A < B ? A : B; }
	template <typename T> static T Max(T A, T B) { return A > B ? A : B; }
	template <typename T> static T Clamp(T X, T Lo, T Hi) { return X < Lo ? Lo : (X > Hi ? Hi : X); }
	template <typename T> static T Abs(T X) { return X < 0 ? -X : X; }
	template <typename T> static T Square(T X) { return X * X; }
	static float Sqrt(float X) { return std::sqrt(X); }
	static double Sqrt(double X) { return std::sqrt(X); }
	static float Sin(float X) { return std::sin(X); }
	static double Sin(double X) { return std::sin(X); }
	static float Cos(float X) { return std::cos(X); }
	static double Cos(double X) { return std::cos(X); }
	static float Atan2(float Y, float X) { return std::atan2(Y, X); }
	static float Pow(float A, float B) { return std::pow(A, B); }
	static double Pow(double A, double B) { return std::pow(A, B); }
	static int32 FloorToInt(float X) { return (int32)std::floor(X); }
	static int32 CeilToInt(float X) { return (int32)std::ceil(X); }
	static int32 RoundToInt(float X) { return FloorToInt(X + 0.5f); }
	static float FloorToFloat(float X) { return std::floor(X); }
	static double FloorToDouble(double X) { return std::floor(X); }
	static float Lerp(float A, float B, float T) { return A + (B - A) * T; }
	static bool IsNearlyZero(float X, float Tol = 1e-8f) { return std::fabs(X) <= Tol; }
};

namespace Algo
{
	template <typename T> void Reverse(TArray<T>& A)
	{
		for (int32 I = 0, J = A.Num() - 1; I < J; ++I, --J) A.Swap(I, J);
	}
}

template <typename F> using TFunctionRef = std::function<F>;
