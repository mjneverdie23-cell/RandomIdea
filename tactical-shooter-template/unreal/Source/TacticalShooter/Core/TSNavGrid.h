#pragma once

#include "CoreMinimal.h"
#include "TSMapGrid.h"

/**
 * A* over the map grid (GAME_RULES.md section 12): 8 neighbours, no corner cutting, octile
 * heuristic, then string-pulling. Temporary obstacles (barriers) can block cells. Bots use
 * this instead of a baked navmesh, exactly like the Unity project (NavGrid.cs).
 */
class TACTICALSHOOTER_API FTSNavGrid
{
public:
	FTSNavGrid() {}
	explicit FTSNavGrid(const FTSMapGrid& InMap);

	const FTSMapGrid& Map() const { return Grid; }
	bool IsWalkable(int32 X, int32 Y) const;
	bool IsWalkable(const FTSCell& C) const { return IsWalkable(C.X, C.Y); }
	/** Block (+1) or release (-1) a cell. Calls nest. */
	void AddDynamicBlock(int32 X, int32 Y, int32 Delta);
	void ClearDynamicBlocks();
	FTSCell NearestWalkable(const FTSCell& C, int32 MaxRadius = 8) const;
	/** Path of cells from Start to Goal (inclusive). */
	bool FindPath(const FTSCell& Start, const FTSCell& Goal, TArray<FTSCell>& OutPath);
	/** Straight line between cell centres stays on walkable cells, with some clearance. */
	bool ClearLine(const FTSCell& A, const FTSCell& B) const;
	/** Same, for continuous grid coordinates (cell units). */
	bool ClearLine(float X0, float Y0, float X1, float Y1) const;
	/** String-pulling: keeps only the corners needed to follow the path. */
	TArray<FTSCell> Smooth(const TArray<FTSCell>& Path) const;

	float LastPathCost = -1.f;

private:
	FTSMapGrid Grid;
	int32 W = 0;
	int32 H = 0;
	TArray<int32> DynamicBlocks;
};
