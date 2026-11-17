"""Builds data/pass_proximity.csv, the table DDAManager uses for "Pass Proximity".

For every level, bots play many games (half "casual", half "sensible"). Before each move
we record the state (moves left, goal progress bucket) and, at the end, whether that game
was won. Each CSV row is then the observed win rate from that state:

    level, moves_left, progress_bucket, win_probability, samples

Smoothing (all of it explainable to a designer):
  * Cells with fewer than MIN_SAMPLES games borrow from the nearest lower bucket.
  * Win probability never decreases with more progress or with more moves left
    (a running maximum over buckets, then over moves).
  * Rows exist for moves_left 0..max(level moves, MAX_REVIVAL_MOVES), so revival lookups
    always land on a row. moves_left = 0 is always 0 (no move, no win).

Replace this file with the same table built from real player telemetry when you have it.

Usage (from the repository root):
    python3 gem-match/tools/sim/make_proximity_csv.py [games_per_level] [seed]
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from simulator import choose_move, is_won, load_levels, new_board, progress_of

BUCKETS = 20  # MUST match DDAManager.BUCKETS
MAX_REVIVAL_MOVES = 10  # MUST be >= MonetizationModel.IAP_MAX_MOVES
MIN_SAMPLES = 5

PROJECT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(PROJECT, "data", "pass_proximity.csv")


def bucket_of(progress):
    return min(BUCKETS - 1, int(progress * BUCKETS))


def simulate(level, games, rng):
    wins = {}
    seen = {}
    for game in range(games):
        policy = "casual" if game % 2 == 0 else "sensible"
        board = new_board(level, rng)
        states = []
        won = False
        for used in range(level["moves"]):
            states.append((level["moves"] - used,
                           bucket_of(progress_of(level, board.score, board.collected))))
            board.play(*choose_move(board, policy, rng))
            if is_won(level, board):
                won = True
                break
        for state in states:
            seen[state] = seen.get(state, 0) + 1
            wins[state] = wins.get(state, 0) + (1 if won else 0)
    return wins, seen


def smooth(level, wins, seen):
    top = max(level["moves"], MAX_REVIVAL_MOVES)
    table = [[0.0] * BUCKETS for _ in range(top + 1)]
    for m in range(1, top + 1):
        last = None
        for b in range(BUCKETS):
            n = seen.get((m, b), 0)
            if n >= MIN_SAMPLES:
                last = wins[(m, b)] / n
            table[m][b] = last if last is not None else 0.0
        for b in range(1, BUCKETS):  # more progress never lowers the chance
            table[m][b] = max(table[m][b], table[m][b - 1])
    for m in range(2, top + 1):  # more moves never lowers the chance
        for b in range(BUCKETS):
            table[m][b] = max(table[m][b], table[m - 1][b])
    return table


def main():
    games = int(sys.argv[1]) if len(sys.argv) > 1 else 800
    rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    levels = load_levels(PROJECT)
    rows = ["level,moves_left,progress_bucket,win_probability,samples"]
    for index, level in enumerate(levels, 1):
        wins, seen = simulate(level, games, rng)
        table = smooth(level, wins, seen)
        for m, probabilities in enumerate(table):
            for b, p in enumerate(probabilities):
                rows.append(f"{index},{m},{b},{p:.4f},{seen.get((m, b), 0)}")
        print(f"level {index}: {len(seen)} observed states from {games} games", flush=True)
    with open(OUT, "w") as f:
        f.write("\n".join(rows) + "\n")
    print(f"wrote {len(rows) - 1} rows to {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
