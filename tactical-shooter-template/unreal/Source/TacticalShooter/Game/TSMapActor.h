#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Core/TSMapGrid.h"
#include "Core/TSNavGrid.h"
#include "TSMapActor.generated.h"

class UInstancedStaticMeshComponent;

/**
 * The built level: grid, navigation and conversions between grid cells and Unreal space
 * (X = north, Y = east, Z = up, centimetres; GAME_RULES.md section 11).
 */
struct FTSWorldMap
{
	FTSMapGrid Grid;
	FTSNavGrid Nav;

	bool IsValid() const { return Grid.IsValid(); }
	FVector CellToWorld(const FTSCell& C, float ZMetres = 0.f) const { return FVector(Grid.North(C.Y), Grid.East(C.X), ZMetres) * 100.f; }
	FTSCell WorldToCell(const FVector& P) const { return Grid.CellAt(P.Y / 100.f, P.X / 100.f); }
	FVector Center() const { return FVector::ZeroVector; }
	TArray<FTSCell> Cells(ETSCellType T) const { return Grid.CellsOf(T); }
	TArray<FTSCell> SpawnCells(ETSSide Side) const { return Cells(Side == ETSSide::Attack ? ETSCellType::AttackSpawn : ETSCellType::DefenseSpawn); }
	bool InSpawnZone(ETSSide Side, const FVector& P) const { const FTSCell C = WorldToCell(P); return Grid.IsSpawnOf(Side, C.X, C.Y); }
	/** 0 = A, 1 = B, -1 = not on a site. */
	int32 SiteAt(const FVector& P) const { const FTSCell C = WorldToCell(P); return Grid.SiteIndexAt(C.X, C.Y); }
	bool HasSite(int32 Site) const { return Grid.Count(Site == 0 ? ETSCellType::SiteA : ETSCellType::SiteB) > 0; }
	FVector SiteCenter(int32 Site) const
	{
		float E, N;
		Grid.Centroid(Site == 0 ? ETSCellType::SiteA : ETSCellType::SiteB, E, N);
		return FVector(N, E, 0.f) * 100.f;
	}
};

/**
 * Builds the level from the ASCII map with basic shapes: a floor slab, merged boxes for walls
 * and cover (instanced, with collision), coloured tiles for sites and spawns, a flag per site,
 * and the lights and sky. The swap point for real level art (see HANDBOOK).
 */
UCLASS()
class TACTICALSHOOTER_API ATSMapActor : public AActor
{
	GENERATED_BODY()

public:
	ATSMapActor();
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	/** Builds geometry and lighting. Returns the grid + navigation for the game mode. */
	FTSWorldMap Build(const FTSMapDef& Def);

private:
	UInstancedStaticMeshComponent* NewInstances(FName Name, const FLinearColor& Color, bool bCollision);
	void AddBoxes(const FTSMapGrid& Grid, ETSCellType Type, float HeightMetres, float InsetMetres, const FLinearColor& Color, bool bCollision, float BaseMetres = 0.f);
	void SpawnLighting();

	/** Sun, sky light and atmosphere; destroyed with the map. */
	UPROPERTY() TArray<TObjectPtr<AActor>> LightingActors;
};
