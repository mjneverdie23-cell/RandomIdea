#pragma once

#include "CoreMinimal.h"

/**
 * The one input contract. ATSPlayerController builds it from keys and the mouse, FTSBotBrain
 * builds it from decisions; ATSCharacter only ever reads an Intent, so every mechanic a player
 * can use, a bot can use too. It is also the natural message to send to a server if the
 * template is networked later. Mirrors Intent.cs.
 */
struct FTSIntent
{
	/** -1..1 each, relative to the view yaw. */
	float MoveForward = 0.f;
	float MoveRight = 0.f;
	/** Absolute desired view angles in degrees (pitch up is positive). */
	float Yaw = 0.f;
	float Pitch = 0.f;
	bool bJump = false;
	bool bCrouch = false;
	bool bWalk = false;
	bool bFire = false;
	bool bAim = false;
	bool bReload = false;
	bool bInteract = false;
	bool bDrop = false;
	/** -1 none, otherwise an ETSWeaponSlot index. */
	int32 SelectSlot = -1;
	/** -1 none, otherwise ability slot 0..3 (C, Q, E, X). */
	int32 UseAbility = -1;

	static FTSIntent Idle(float InYaw, float InPitch)
	{
		FTSIntent I;
		I.Yaw = InYaw;
		I.Pitch = InPitch;
		return I;
	}
};
