#include "TSMapGrid.h"

FTSMapGrid FTSMapGrid::Parse(const FTSMapDef& Def, TArray<FString>& OutErrors)
{
	FTSMapGrid G;
	if (Def.Rows.Num() == 0)
	{
		OutErrors.Add(TEXT("map has no rows"));
		return G;
	}
	int32 W = 0;
	for (const FString& Row : Def.Rows) W = FMath::Max(W, Row.Len());
	G.Def = Def;
	G.Width = W;
	G.Height = Def.Rows.Num();
	G.CellSize = Def.CellSize;
	G.Cells.SetNum(W * G.Height);
	for (int32 Y = 0; Y < G.Height; ++Y)
	{
		const FString& Row = Def.Rows[Y];
		if (Row.Len() != W) OutErrors.Add(FString::Printf(TEXT("row %d has length %d, expected %d"), Y, Row.Len(), W));
		for (int32 X = 0; X < W; ++X)
		{
			const TCHAR Ch = X < Row.Len() ? Row[X] : TEXT('#');
			ETSCellType T;
			if (!TryParseSymbol(Ch, T))
			{
				OutErrors.Add(FString::Printf(TEXT("unknown symbol '%c' at (%d,%d)"), Ch, X, Y));
				T = ETSCellType::Wall;
			}
			G.Cells[Y * W + X] = T;
		}
	}
	if (Def.CellSize <= 0.f) OutErrors.Add(TEXT("cellSize must be > 0"));
	return G;
}

bool FTSMapGrid::TryParseSymbol(TCHAR Ch, ETSCellType& Out)
{
	switch (Ch)
	{
	case TEXT('#'): Out = ETSCellType::Wall; return true;
	case TEXT('.'): Out = ETSCellType::Floor; return true;
	case TEXT('c'): Out = ETSCellType::LowCover; return true;
	case TEXT('h'): Out = ETSCellType::HighCover; return true;
	case TEXT('A'): Out = ETSCellType::SiteA; return true;
	case TEXT('B'): Out = ETSCellType::SiteB; return true;
	case TEXT('T'): Out = ETSCellType::AttackSpawn; return true;
	case TEXT('D'): Out = ETSCellType::DefenseSpawn; return true;
	default: Out = ETSCellType::Wall; return false;
	}
}

TArray<FTSCell> FTSMapGrid::CellsOf(ETSCellType T) const
{
	TArray<FTSCell> Out;
	for (int32 Y = 0; Y < Height; ++Y)
		for (int32 X = 0; X < Width; ++X)
			if (Cells[Y * Width + X] == T) Out.Add(FTSCell(X, Y));
	return Out;
}

int32 FTSMapGrid::Count(ETSCellType T) const
{
	int32 N = 0;
	for (const ETSCellType C : Cells) if (C == T) ++N;
	return N;
}

TArray<FTSGridBox> FTSMapGrid::Boxes(ETSCellType T) const
{
	TArray<bool> Used;
	Used.Init(false, Cells.Num());
	TArray<FTSGridBox> Out;
	for (int32 Y = 0; Y < Height; ++Y)
	{
		for (int32 X = 0; X < Width; ++X)
		{
			const int32 I = Y * Width + X;
			if (Used[I] || Cells[I] != T) continue;
			int32 W = 1;
			while (X + W < Width && !Used[I + W] && Cells[I + W] == T) ++W;
			int32 H = 1;
			while (Y + H < Height)
			{
				bool bRowOk = true;
				for (int32 XX = X; XX < X + W; ++XX)
				{
					const int32 J = (Y + H) * Width + XX;
					if (Used[J] || Cells[J] != T) { bRowOk = false; break; }
				}
				if (!bRowOk) break;
				++H;
			}
			for (int32 YY = Y; YY < Y + H; ++YY)
				for (int32 XX = X; XX < X + W; ++XX)
					Used[YY * Width + XX] = true;
			FTSGridBox Box;
			Box.X = X;
			Box.Y = Y;
			Box.W = W;
			Box.H = H;
			Box.Type = T;
			Out.Add(Box);
		}
	}
	return Out;
}

bool FTSMapGrid::Centroid(ETSCellType T, float& OutEast, float& OutNorth) const
{
	double SX = 0.0, SY = 0.0;
	int32 N = 0;
	for (int32 Y = 0; Y < Height; ++Y)
		for (int32 X = 0; X < Width; ++X)
			if (Cells[Y * Width + X] == T) { SX += East(X); SY += North(Y); ++N; }
	OutEast = N > 0 ? (float)(SX / N) : 0.f;
	OutNorth = N > 0 ? (float)(SY / N) : 0.f;
	return N > 0;
}

TArray<FString> FTSMapGrid::Validate(int32 TeamSize) const
{
	TArray<FString> Errors;
	for (int32 Y = 0; Y < Height; ++Y)
		for (int32 X = 0; X < Width; ++X)
			if ((X == 0 || Y == 0 || X == Width - 1 || Y == Height - 1) && Get(X, Y) != ETSCellType::Wall)
			{
				Errors.Add(FString::Printf(TEXT("border cell (%d,%d) must be a wall"), X, Y));
				return Errors;
			}
	if (Count(ETSCellType::AttackSpawn) < TeamSize) Errors.Add(FString::Printf(TEXT("needs at least %d attacker spawn (T) cells"), TeamSize));
	if (Count(ETSCellType::DefenseSpawn) < TeamSize) Errors.Add(FString::Printf(TEXT("needs at least %d defender spawn (D) cells"), TeamSize));
	if (Count(ETSCellType::SiteA) + Count(ETSCellType::SiteB) == 0) Errors.Add(TEXT("has no bomb site"));

	// Every walkable cell must be reachable from every other (4-connectivity).
	int32 Total = 0;
	int32 Start = INDEX_NONE;
	for (int32 I = 0; I < Cells.Num(); ++I)
		if (IsWalkable(I % Width, I / Width)) { ++Total; if (Start == INDEX_NONE) Start = I; }
	if (Start == INDEX_NONE)
	{
		Errors.Add(TEXT("has no walkable cells"));
		return Errors;
	}
	TArray<bool> Seen;
	Seen.Init(false, Cells.Num());
	TArray<int32> Stack;
	Stack.Add(Start);
	Seen[Start] = true;
	int32 Reached = 0;
	while (Stack.Num() > 0)
	{
		const int32 I = Stack.Pop();
		++Reached;
		const int32 X = I % Width, Y = I / Width;
		const int32 NX[4] = { X + 1, X - 1, X, X };
		const int32 NY[4] = { Y, Y, Y + 1, Y - 1 };
		for (int32 K = 0; K < 4; ++K)
		{
			if (!IsWalkable(NX[K], NY[K])) continue;
			const int32 N = NY[K] * Width + NX[K];
			if (Seen[N]) continue;
			Seen[N] = true;
			Stack.Add(N);
		}
	}
	if (Reached != Total) Errors.Add(FString::Printf(TEXT("%d walkable cells cannot be reached from the rest"), Total - Reached));
	return Errors;
}
