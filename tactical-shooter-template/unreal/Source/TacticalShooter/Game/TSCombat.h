#pragma once

#include "CoreMinimal.h"
#include "Core/TSConfigTypes.h"

class ATSGameMode;
class ATSCharacter;

/**
 * Hit resolution shared by players and bots: bullets, melee, explosions and line of sight.
 * Traces are object-type queries (WorldStatic, WorldDynamic, Pawn) so no custom collision
 * channels are needed. Characters are hit on their capsule and the zone comes from the hit
 * height. Smoke blocks sight but not bullets. Mirrors Combat.cs.
 */
struct FTSCombat
{
	ATSGameMode* Mode = nullptr;

	/** Traces one bullet (cm) and applies damage. Returns where it stopped. */
	FVector FireBullet(ATSCharacter* Shooter, const FVector& Origin, const FVector& Dir, const FTSWeaponDef& W) const;
	/** Knife: short sphere sweep in front; double damage from behind. */
	void Melee(ATSCharacter* Attacker, const FTSWeaponDef& W) const;
	/** True if no world geometry and no smoke is between the two points. */
	bool LineOfSight(const FVector& From, const FVector& To) const;
	/** True if no world geometry is between the two points (smoke ignored). */
	bool ClearPath(const FVector& From, const FVector& To) const;
	/** Linear-falloff area damage. Radius in metres. */
	void Explosion(const FVector& Center, float RadiusMetres, float MaxDamage, float ArmorPenetration, ATSCharacter* Owner, const FString& SourceId, bool bNeedsSight) const;
};
