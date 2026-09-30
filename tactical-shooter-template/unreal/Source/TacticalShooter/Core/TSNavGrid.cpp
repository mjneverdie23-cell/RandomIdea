#include "TSNavGrid.h"
#include "Algo/Reverse.h"

namespace
{
	const float Sqrt2 = 1.41421356237f;
	const float ClearanceCells = 0.25f;

	float Heuristic(int32 X, int32 Y, int32 GX, int32 GY)
	{
		const int32 DX = FMath::Abs(X - GX), DY = FMath::Abs(Y - GY);
		return (float)(DX + DY) + (Sqrt2 - 2.f) * (float)FMath::Min(DX, DY);
	}

	/** Binary min-heap of (priority, index) with lazy deletion. */
	struct FOpenHeap
	{
		TArray<float> Keys;
		TArray<int32> Values;

		int32 Num() const { return Keys.Num(); }

		void Push(float Key, int32 Value)
		{
			Keys.Add(Key);
			Values.Add(Value);
			int32 I = Keys.Num() - 1;
			while (I > 0)
			{
				const int32 P = (I - 1) / 2;
				if (Keys[P] <= Keys[I]) break;
				Keys.Swap(I, P);
				Values.Swap(I, P);
				I = P;
			}
		}

		int32 Pop()
		{
			const int32 Top = Values[0];
			const int32 Last = Keys.Num() - 1;
			Keys[0] = Keys[Last];
			Values[0] = Values[Last];
			Keys.RemoveAt(Last);
			Values.RemoveAt(Last);
			int32 I = 0;
			for (;;)
			{
				const int32 L = 2 * I + 1, R = L + 1;
				int32 M = I;
				if (L < Keys.Num() && Keys[L] < Keys[M]) M = L;
				if (R < Keys.Num() && Keys[R] < Keys[M]) M = R;
				if (M == I) break;
				Keys.Swap(I, M);
				Values.Swap(I, M);
				I = M;
			}
			return Top;
		}
	};
}

FTSNavGrid::FTSNavGrid(const FTSMapGrid& InMap)
	: Grid(InMap), W(InMap.Width), H(InMap.Height)
{
	DynamicBlocks.Init(0, W * H);
}

bool FTSNavGrid::IsWalkable(int32 X, int32 Y) const
{
	return X >= 0 && Y >= 0 && X < W && Y < H && Grid.IsWalkable(X, Y) && DynamicBlocks[Y * W + X] == 0;
}

void FTSNavGrid::AddDynamicBlock(int32 X, int32 Y, int32 Delta)
{
	if (X < 0 || Y < 0 || X >= W || Y >= H) return;
	DynamicBlocks[Y * W + X] = FMath::Max(0, DynamicBlocks[Y * W + X] + Delta);
}

void FTSNavGrid::ClearDynamicBlocks()
{
	for (int32& B : DynamicBlocks) B = 0;
}

FTSCell FTSNavGrid::NearestWalkable(const FTSCell& C, int32 MaxRadius) const
{
	if (IsWalkable(C)) return C;
	for (int32 R = 1; R <= MaxRadius; ++R)
		for (int32 DY = -R; DY <= R; ++DY)
			for (int32 DX = -R; DX <= R; ++DX)
			{
				if (FMath::Abs(DX) != R && FMath::Abs(DY) != R) continue;
				if (IsWalkable(C.X + DX, C.Y + DY)) return FTSCell(C.X + DX, C.Y + DY);
			}
	return C;
}

bool FTSNavGrid::FindPath(const FTSCell& Start, const FTSCell& Goal, TArray<FTSCell>& OutPath)
{
	OutPath.Reset();
	LastPathCost = -1.f;
	if (!IsWalkable(Start) || !IsWalkable(Goal)) return false;
	const int32 N = W * H;
	TArray<float> GScore;
	GScore.Init(TNumericLimits<float>::Max(), N);
	TArray<int32> Parent;
	Parent.Init(-1, N);
	TArray<bool> Closed;
	Closed.Init(false, N);
	FOpenHeap Open;

	const int32 S = Start.Y * W + Start.X, G = Goal.Y * W + Goal.X;
	GScore[S] = 0.f;
	Open.Push(Heuristic(Start.X, Start.Y, Goal.X, Goal.Y), S);
	while (Open.Num() > 0)
	{
		const int32 Cur = Open.Pop();
		if (Closed[Cur]) continue;
		if (Cur == G)
		{
			LastPathCost = GScore[Cur];
			for (int32 C = Cur; C != -1; C = Parent[C]) OutPath.Add(FTSCell(C % W, C / W));
			Algo::Reverse(OutPath);
			return true;
		}
		Closed[Cur] = true;
		const int32 CX = Cur % W, CY = Cur / W;
		for (int32 DY = -1; DY <= 1; ++DY)
		{
			for (int32 DX = -1; DX <= 1; ++DX)
			{
				if (DX == 0 && DY == 0) continue;
				const int32 NX = CX + DX, NY = CY + DY;
				if (!IsWalkable(NX, NY)) continue;
				const bool bDiagonal = DX != 0 && DY != 0;
				if (bDiagonal && (!IsWalkable(CX + DX, CY) || !IsWalkable(CX, CY + DY))) continue;
				const int32 Next = NY * W + NX;
				if (Closed[Next]) continue;
				const float Cost = GScore[Cur] + (bDiagonal ? Sqrt2 : 1.f);
				if (Cost < GScore[Next] - 1e-6f)
				{
					GScore[Next] = Cost;
					Parent[Next] = Cur;
					Open.Push(Cost + Heuristic(NX, NY, Goal.X, Goal.Y), Next);
				}
			}
		}
	}
	return false;
}

bool FTSNavGrid::ClearLine(const FTSCell& A, const FTSCell& B) const
{
	return ClearLine(A.X + 0.5f, A.Y + 0.5f, B.X + 0.5f, B.Y + 0.5f);
}

bool FTSNavGrid::ClearLine(float X0, float Y0, float X1, float Y1) const
{
	const float DX = X1 - X0, DY = Y1 - Y0;
	const float Len = FMath::Sqrt(DX * DX + DY * DY);
	if (Len < 1e-4f) return IsWalkable(FMath::FloorToInt(X0), FMath::FloorToInt(Y0));
	const float PX = -DY / Len * ClearanceCells, PY = DX / Len * ClearanceCells;
	const int32 Steps = FMath::CeilToInt(Len / 0.25f);
	for (int32 I = 0; I <= Steps; ++I)
	{
		const float T = (float)I / (float)Steps;
		const float X = X0 + DX * T, Y = Y0 + DY * T;
		if (!IsWalkable(FMath::FloorToInt(X), FMath::FloorToInt(Y))) return false;
		if (!IsWalkable(FMath::FloorToInt(X + PX), FMath::FloorToInt(Y + PY))) return false;
		if (!IsWalkable(FMath::FloorToInt(X - PX), FMath::FloorToInt(Y - PY))) return false;
	}
	return true;
}

TArray<FTSCell> FTSNavGrid::Smooth(const TArray<FTSCell>& Path) const
{
	TArray<FTSCell> Result;
	if (Path.Num() == 0) return Result;
	int32 I = 0;
	Result.Add(Path[0]);
	while (I < Path.Num() - 1)
	{
		int32 Next = I + 1;
		for (int32 J = Path.Num() - 1; J > I + 1; --J)
		{
			if (ClearLine(Path[I], Path[J])) { Next = J; break; }
		}
		Result.Add(Path[Next]);
		I = Next;
	}
	return Result;
}
