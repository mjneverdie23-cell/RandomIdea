#pragma once

#include "CoreMinimal.h"
#include "TSEnums.h"
#include "TSConfigTypes.h"

struct FTSCell
{
	int32 X = 0;
	int32 Y = 0;
	FTSCell() {}
	FTSCell(int32 InX, int32 InY) : X(InX), Y(InY) {}
	bool operator==(const FTSCell& O) const { return X == O.X && Y == O.Y; }
	bool operator!=(const FTSCell& O) const { return !(*this == O); }
};

/** A merged rectangle of same-type cells: columns [X, X+W), rows [Y, Y+H). */
struct FTSGridBox
{
	int32 X = 0, Y = 0, W = 0, H = 0;
	ETSCellType Type = ETSCellType::Wall;
};

/**
 * The ASCII map, parsed (GAME_RULES.md section 11). Geometry and navigation are both generated
 * from it. "Plane" coordinates are metres: East and North. Unreal maps them to
 * X = North * 100, Y = East * 100 (centimetres). Mirrors MapGrid.cs.
 */
class TACTICALSHOOTER_API FTSMapGrid
{
public:
	static FTSMapGrid Parse(const FTSMapDef& Def, TArray<FString>& OutErrors);
	static bool TryParseSymbol(TCHAR Ch, ETSCellType& Out);

	bool IsValid() const { return Width > 0 && Height > 0; }
	bool InBounds(int32 X, int32 Y) const { return X >= 0 && Y >= 0 && X < Width && Y < Height; }
	ETSCellType Get(int32 X, int32 Y) const { return InBounds(X, Y) ? Cells[Y * Width + X] : ETSCellType::Wall; }
	ETSCellType Get(const FTSCell& C) const { return Get(C.X, C.Y); }
	/** Walkable for navigation: floor, sites and spawns. Cover and walls are not. */
	bool IsWalkable(int32 X, int32 Y) const
	{
		const ETSCellType T = Get(X, Y);
		return T != ETSCellType::Wall && T != ETSCellType::LowCover && T != ETSCellType::HighCover;
	}
	/** 0 for site A, 1 for site B, -1 otherwise. */
	int32 SiteIndexAt(int32 X, int32 Y) const
	{
		const ETSCellType T = Get(X, Y);
		return T == ETSCellType::SiteA ? 0 : T == ETSCellType::SiteB ? 1 : -1;
	}
	bool IsSpawnOf(ETSSide Side, int32 X, int32 Y) const
	{
		return Get(X, Y) == (Side == ETSSide::Attack ? ETSCellType::AttackSpawn : ETSCellType::DefenseSpawn);
	}

	float East(int32 X) const { return ((float)X + 0.5f - (float)Width / 2.f) * CellSize; }
	float North(int32 Y) const { return ((float)Height / 2.f - (float)Y - 0.5f) * CellSize; }
	FTSCell CellAt(float InEast, float InNorth) const
	{
		return FTSCell(FMath::FloorToInt(InEast / CellSize + (float)Width / 2.f), FMath::FloorToInt((float)Height / 2.f - InNorth / CellSize));
	}
	/** Continuous grid coordinates (cell units, cell centres at +0.5) from plane metres. */
	void GridPoint(float InEast, float InNorth, float& OutX, float& OutY) const
	{
		OutX = InEast / CellSize + (float)Width / 2.f;
		OutY = (float)Height / 2.f - InNorth / CellSize;
	}
	float WorldWidth() const { return Width * CellSize; }
	float WorldHeight() const { return Height * CellSize; }

	TArray<FTSCell> CellsOf(ETSCellType T) const;
	int32 Count(ETSCellType T) const;
	/** Greedy merge of same-type cells into rectangles: extend right first, then down. */
	TArray<FTSGridBox> Boxes(ETSCellType T) const;
	bool Centroid(ETSCellType T, float& OutEast, float& OutNorth) const;
	TArray<FString> Validate(int32 TeamSize) const;

	FTSMapDef Def;
	int32 Width = 0;
	int32 Height = 0;
	float CellSize = 2.f;

private:
	TArray<ETSCellType> Cells;
};
