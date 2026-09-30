#pragma once

#include "CoreMinimal.h"
#include "TSConfigTypes.h"

/**
 * Engine-neutral key names used by shared/config/input.json (same list as KeyNames.cs in the
 * Unity project). ATSPlayerController maps them to FKeys in one table.
 */
namespace TSKeyNames
{
	inline const TArray<FString>& All()
	{
		static TArray<FString> Names;
		if (Names.Num() == 0)
		{
			for (TCHAR C = TEXT('A'); C <= TEXT('Z'); ++C) Names.Add(FString::Chr(C));
			for (TCHAR C = TEXT('0'); C <= TEXT('9'); ++C) Names.Add(FString::Chr(C));
			for (int32 i = 1; i <= 12; ++i) Names.Add(FString::Printf(TEXT("F%d"), i));
			const TCHAR* Rest[] = {
				TEXT("Space"), TEXT("Enter"), TEXT("Escape"), TEXT("Tab"), TEXT("Backspace"), TEXT("LeftShift"), TEXT("RightShift"),
				TEXT("LeftCtrl"), TEXT("RightCtrl"), TEXT("LeftAlt"), TEXT("RightAlt"), TEXT("Up"), TEXT("Down"), TEXT("Left"), TEXT("Right"),
				TEXT("Mouse1"), TEXT("Mouse2"), TEXT("Mouse3"), TEXT("Mouse4"), TEXT("Mouse5"), TEXT("WheelUp"), TEXT("WheelDown"),
				TEXT("CapsLock"), TEXT("Backquote"), TEXT("Minus"), TEXT("Equals"), TEXT("Comma"), TEXT("Period"), TEXT("Slash"),
				TEXT("Semicolon"), TEXT("Quote"), TEXT("LeftBracket"), TEXT("RightBracket"), TEXT("Backslash"), TEXT("Insert"),
				TEXT("Delete"), TEXT("Home"), TEXT("End"), TEXT("PageUp"), TEXT("PageDown") };
			for (const TCHAR* R : Rest) Names.Add(R);
		}
		return Names;
	}

	inline const TArray<FString>& Actions()
	{
		static TArray<FString> Names;
		if (Names.Num() == 0)
		{
			const TCHAR* List[] = {
				TEXT("MoveForward"), TEXT("MoveBack"), TEXT("MoveLeft"), TEXT("MoveRight"), TEXT("Jump"), TEXT("Crouch"), TEXT("Walk"),
				TEXT("Fire"), TEXT("Aim"), TEXT("Reload"), TEXT("Interact"), TEXT("Drop"), TEXT("Primary"), TEXT("Secondary"), TEXT("Melee"),
				TEXT("Ability1"), TEXT("Ability2"), TEXT("Ability3"), TEXT("Ultimate"), TEXT("BuyMenu"), TEXT("Scoreboard"), TEXT("Pause") };
			for (const TCHAR* A : List) Names.Add(A);
		}
		return Names;
	}

	inline bool IsValid(const FString& Name) { return All().Contains(Name); }

	inline FString Label(const FString& Name)
	{
		if (Name.IsEmpty()) return TEXT("-");
		if (Name == TEXT("Mouse1")) return TEXT("LMB");
		if (Name == TEXT("Mouse2")) return TEXT("RMB");
		if (Name == TEXT("Mouse3")) return TEXT("MMB");
		if (Name == TEXT("LeftCtrl")) return TEXT("L-Ctrl");
		if (Name == TEXT("RightCtrl")) return TEXT("R-Ctrl");
		if (Name == TEXT("LeftShift")) return TEXT("L-Shift");
		if (Name == TEXT("RightShift")) return TEXT("R-Shift");
		if (Name == TEXT("LeftAlt")) return TEXT("L-Alt");
		if (Name == TEXT("RightAlt")) return TEXT("R-Alt");
		if (Name == TEXT("Escape")) return TEXT("Esc");
		return Name;
	}

	inline FString ActionLabel(const FString& Action)
	{
		struct FPair { const TCHAR* Action; const TCHAR* Label; };
		static const FPair Labels[] = {
			{ TEXT("MoveForward"), TEXT("Move forward") }, { TEXT("MoveBack"), TEXT("Move back") },
			{ TEXT("MoveLeft"), TEXT("Move left") }, { TEXT("MoveRight"), TEXT("Move right") },
			{ TEXT("Walk"), TEXT("Walk (quiet, accurate)") }, { TEXT("Aim"), TEXT("Aim / scope") },
			{ TEXT("Interact"), TEXT("Plant / defuse / pick up") }, { TEXT("Drop"), TEXT("Drop weapon / bomb") },
			{ TEXT("Primary"), TEXT("Primary weapon") }, { TEXT("Secondary"), TEXT("Sidearm") }, { TEXT("Melee"), TEXT("Knife") },
			{ TEXT("Ability1"), TEXT("Ability 1 (C)") }, { TEXT("Ability2"), TEXT("Ability 2 (Q)") },
			{ TEXT("Ability3"), TEXT("Signature (E)") }, { TEXT("Ultimate"), TEXT("Ultimate (X)") },
			{ TEXT("BuyMenu"), TEXT("Buy menu") }, { TEXT("Scoreboard"), TEXT("Scoreboard (hold)") }, { TEXT("Pause"), TEXT("Pause menu") },
		};
		for (const FPair& P : Labels) if (Action == P.Action) return P.Label;
		return Action;
	}
}

/**
 * Action -> key with the player's overrides applied on top of input.json. An override entry
 * always carries both keys (an empty AltKey means "no alternative key").
 */
struct FTSKeyMap
{
	TArray<FTSKeyBinding> Bindings;

	FTSKeyMap() {}

	FTSKeyMap(const FTSInputConfig& Defaults, const TArray<FTSKeyBinding>& Overrides)
	{
		Bindings = Defaults.Bindings;
		for (const FTSKeyBinding& O : Overrides)
		{
			for (FTSKeyBinding& B : Bindings)
			{
				if (B.Action != O.Action) continue;
				if (!O.Key.IsEmpty()) B.Key = O.Key;
				B.AltKey = O.AltKey;
			}
		}
	}

	FString Key(const FString& Action) const
	{
		for (const FTSKeyBinding& B : Bindings) if (B.Action == Action) return B.Key;
		return FString();
	}

	FString AltKey(const FString& Action) const
	{
		for (const FTSKeyBinding& B : Bindings) if (B.Action == Action) return B.AltKey;
		return FString();
	}
};
