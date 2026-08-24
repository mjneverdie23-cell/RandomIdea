#!/usr/bin/env python3
"""
Turn an Oracle's Elixir match export into a paste-ready backtest queue.

Reads the yearly CSV, keeps the competitions DraftCall tracks, and writes one
JSON file holding every game in a date range — by default 1 July through today
— in the shape the Predictor's "Load matches" box accepts. Copy the file's
contents, paste, and step through the games.

    python scripts/export_matches.py 2026_LoL_esports_match_data_from_OraclesElixir.csv

    # a different window, and a named output
    python scripts/export_matches.py data.csv --from 2026-05-01 --to 2026-08-01 \
        --out msi-backtest.json

    # one league only, newest first
    python scripts/export_matches.py data.csv --league LCK --order desc

**The result of each game is never written.** Kills, gold and game length are
dropped too: the file is predictor input, and a backtest that can see the answer
is not a backtest. Check each prediction against the real result yourself.

The one thing derived from results is the series score *entering* each game — a
1-1 going into game three is what any analyst would know beforehand, so it is
included and drives the series odds. The winner of the game being predicted is
read only to build that running score for later games, then discarded.

Standard library only — no pandas, no install step.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

# Mirrors src/domain/competitions.ts. Oracle's Elixir writes several spellings
# per competition and has changed them between seasons, so match on all of them.
COMPETITIONS: dict[str, tuple[str, ...]] = {
    "LCK": ("LCK",),
    "LEC": ("LEC",),
    "LCS": ("LCS", "NA LCS", "LTA N", "LTA S", "LTA"),
    "LPL": ("LPL",),
    # PCS is intentionally absent: since the 2025 merger it is the tier-two
    # league below LCP, not LCP's old name. See competitions.ts.
    "LCP": ("LCP",),
    "WORLDS": ("WLDS", "WORLDS", "WCS"),
    "MSI": ("MSI",),
    "FIRST_STAND": ("FST", "FIRST STAND"),
    "EWC": ("EWC", "ESPORTS WORLD CUP"),
}

# Leagues whose names collide with a tracked competition but are a different
# tier entirely; without these an academy game reads as an LCK game.
EXCLUDED = (
    "CL",
    "ACADEMY",
    "CHALLENGER",
    "CHALLENGERS",
    "LDL",
    "NACL",
    "LCKC",
    "AL",
    "DEMACIA",
)

ROLES = {
    "top": "top",
    "jng": "jungle",
    "jungle": "jungle",
    "mid": "mid",
    "bot": "bot",
    "adc": "bot",
    "sup": "support",
    "support": "support",
}

ROLE_ORDER = ("top", "jungle", "mid", "bot", "support")


def resolve_competition(league: str) -> str | None:
    """Map a league cell to one of the tracked competitions, or None."""
    cleaned = (league or "").strip().upper()
    if not cleaned:
        return None
    if cleaned in EXCLUDED:
        return None
    for competition, aliases in COMPETITIONS.items():
        if cleaned in aliases:
            return competition
    return None


def parse_datetime(raw: str) -> datetime | None:
    """Full kickoff time. Day granularity cannot order games within a series."""
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d"):
        try:
            return datetime.strptime((raw or "").strip(), pattern)
        except ValueError:
            continue
    return None


def series_length(games_played: int, games_won_by_winner: int) -> str:
    """
    Oracle's Elixir has no best-of column, so the format is inferred.

    Both signals are needed, and the format has to be able to hold what actually
    happened. Counting games alone reads every Bo5 sweep as a Bo3, because a 3-0
    and a 2-1 both run to three games — which then puts an impossible 0-2 into a
    best-of-three. Counting the winner's games alone mislabels a two-game 1-1
    (a Bo2, or a Bo3 whose decider is missing from the export) as a Bo1, where a
    1-0 cannot exist either.

    A race to `t` wins spans between `t` and `2t - 1` games, so the smallest
    format that fits is the larger of the winner's total and the games played
    rounded up.
    """
    target = max(games_won_by_winner, (games_played + 2) // 2, 1)
    if target >= 3:
        return "BO5"
    if target == 2:
        return "BO3"
    return "BO1"


def stage_of(row: dict[str, str]) -> str:
    playoffs = (row.get("playoffs") or "").strip()
    split = (row.get("split") or "").strip().lower()
    if "final" in split:
        return "final"
    if "semi" in split:
        return "semifinal"
    if "quarter" in split:
        return "quarterfinal"
    if "play-in" in split or "playin" in split:
        return "playin"
    if "group" in split or "swiss" in split:
        return "group"
    return "playoffs" if playoffs == "1" else "regular"


def default_window(rows_year: int | None) -> tuple[date, date]:
    today = date.today()
    year = rows_year or today.year
    start = date(year, 7, 1)
    # A file from a past season would otherwise yield an empty window.
    end = today if year == today.year else date(year, 12, 31)
    return start, end


def build(args: argparse.Namespace) -> int:
    path = Path(args.csv)
    if not path.exists():
        print(f"No such file: {path}", file=sys.stderr)
        return 1

    # gameid -> {"meta": {...}, "sides": {"Blue": {...}, "Red": {...}}}
    games: dict[str, dict] = {}
    seen_years: list[int] = []

    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"gameid", "league", "date", "position", "champion", "teamname", "side", "result"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            print(
                "That CSV is missing column(s): "
                + ", ".join(sorted(missing))
                + ".\nIt does not look like an Oracle's Elixir match export.",
                file=sys.stderr,
            )
            return 1

        for row in reader:
            if (row.get("datacompleteness") or "").strip().lower() == "ignore":
                continue

            competition = resolve_competition(row.get("league", ""))
            if competition is None:
                continue
            if args.league and competition != args.league.strip().upper():
                continue

            played = parse_datetime(row.get("date", ""))
            if played is None:
                continue
            seen_years.append(played.year)

            game_id = (row.get("gameid") or "").strip()
            if not game_id:
                continue

            entry = games.setdefault(
                game_id,
                {
                    "kickoff": played,
                    "date": played.date(),
                    "competition": competition,
                    "stage": stage_of(row),
                    "game": int(float(row.get("game") or 1)),
                    "teams": {},
                    "won_by": None,
                    "sides": defaultdict(dict),
                },
            )

            if played < entry["kickoff"]:
                entry["kickoff"] = played

            side = (row.get("side") or "").strip().capitalize()
            if side not in ("Blue", "Red"):
                continue

            team = (row.get("teamname") or "").strip()
            if team:
                entry["teams"][side] = team
                # Kept only to reconstruct the score going INTO each later game.
                # It is never written out for the game it belongs to.
                if (row.get("result") or "").strip() == "1":
                    entry["won_by"] = team

            role = ROLES.get((row.get("position") or "").strip().lower())
            champion = (row.get("champion") or "").strip()
            if role and champion:
                entry["sides"][side][role] = champion

    if not games:
        print("No games matched the configured competitions.", file=sys.stderr)
        return 1

    start, end = default_window(max(seen_years) if seen_years else None)
    if args.date_from:
        start = datetime.strptime(args.date_from, "%Y-%m-%d").date()
    if args.date_to:
        end = datetime.strptime(args.date_to, "%Y-%m-%d").date()

    # Series score entering each game, reconstructed from the games before it.
    #
    # This is legitimate pre-game information: going into game three you know
    # the series is 1-1, and so does every analyst. What must never appear is
    # the result of the game being predicted, which is why the winner is read
    # here and then discarded rather than written out.
    by_series: dict[tuple, list[tuple[int, str, dict]]] = defaultdict(list)
    for game_id, entry in games.items():
        if len(entry["teams"]) != 2:
            continue
        key = (entry["competition"], entry["date"], tuple(sorted(entry["teams"].values())))
        by_series[key].append((entry["game"], game_id, entry))

    score_before: dict[str, dict[str, int]] = {}
    series_format: dict[tuple, str] = {}
    for key, members in by_series.items():
        members.sort(key=lambda item: (item[0], item[2]["kickoff"]))
        tally: dict[str, int] = defaultdict(int)
        for _game_no, game_id, entry in members:
            score_before[game_id] = dict(tally)
            if entry["won_by"]:
                tally[entry["won_by"]] += 1
        series_format[key] = series_length(
            len(members), max(tally.values()) if tally else 1
        )

    kept = []
    skipped_incomplete = 0

    for game_id, entry in games.items():
        if not (start <= entry["date"] <= end):
            continue
        if len(entry["teams"]) != 2:
            skipped_incomplete += 1
            continue
        if any(len(entry["sides"][side]) != len(ROLE_ORDER) for side in ("Blue", "Red")):
            skipped_incomplete += 1
            continue

        key = (
            entry["competition"],
            entry["date"],
            tuple(sorted(entry["teams"].values())),
        )
        best_of = series_format.get(key, "BO3")

        # Score entering this game, from the point of view of the sides as they
        # line up here — teams swap sides between games, so a 1-0 lead can
        # belong to blue in game one and red in game two.
        tally = score_before.get(game_id, {})
        blue_wins = tally.get(entry["teams"]["Blue"], 0)
        red_wins = tally.get(entry["teams"]["Red"], 0)
        played_before = blue_wins + red_wins

        kept.append(
            {
                "_series": key,
                "_kickoff": entry["kickoff"],
                "id": game_id,
                "date": entry["date"].isoformat(),
                # Full kickoff, so a backtest can cut its history at the moment
                # this game started rather than at the start of the day.
                "kickoff": entry["kickoff"].isoformat(),
                "competition": entry["competition"],
                "stage": entry["stage"],
                "series": best_of,
                "game": entry["game"],
                "gamesPlayedBefore": played_before,
                "score": [blue_wins, red_wins],
                "blue": {"team": entry["teams"]["Blue"], **entry["sides"]["Blue"]},
                "red": {"team": entry["teams"]["Red"], **entry["sides"]["Red"]},
            }
        )

    # Order series-by-series, each series in game order.
    #
    # Sorting on (date, id) interleaved concurrent series and scattered their
    # games — Oracle's Elixir game ids are not sequential within a series, so a
    # best-of-five came out G1, G3, G4, G2, G5. Series are ordered by when they
    # started; games inside one follow the game counter, with kickoff breaking
    # any tie.
    series_start: dict[tuple, datetime] = {}
    for match in kept:
        key = match["_series"]
        earliest = series_start.get(key)
        if earliest is None or match["_kickoff"] < earliest:
            series_start[key] = match["_kickoff"]

    kept.sort(key=lambda m: (series_start[m["_series"]], m["_series"], m["game"], m["_kickoff"]))
    if args.order == "desc":
        kept.reverse()
    if args.limit:
        kept = kept[: args.limit]

    for match in kept:
        del match["_series"]
        del match["_kickoff"]

    if not kept:
        print(
            f"No games between {start} and {end}. "
            "Use --from / --to to widen the window.",
            file=sys.stderr,
        )
        return 1

    payload = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "source": path.name,
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "note": "Winner intentionally omitted — this is predictor input, not results.",
        "matches": kept,
    }

    out = Path(args.out)
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    per_competition: dict[str, int] = defaultdict(int)
    for match in kept:
        per_competition[match["competition"]] += 1
    breakdown = ", ".join(f"{k} {v}" for k, v in sorted(per_competition.items()))

    print(f"Wrote {len(kept)} games ({start} to {end}) -> {out}")
    print(f"  {breakdown}")
    if skipped_incomplete:
        print(f"  {skipped_incomplete} game(s) skipped: incomplete draft or missing team")
    print(f"  {out.stat().st_size / 1024:.0f} KB — paste the contents into the Predictor")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export Oracle's Elixir games as a paste-ready predictor queue.",
    )
    parser.add_argument("csv", help="Oracle's Elixir match-data CSV")
    parser.add_argument(
        "--from",
        dest="date_from",
        help="start date, YYYY-MM-DD (default: 1 July of the file's latest season)",
    )
    parser.add_argument(
        "--to",
        dest="date_to",
        help="end date, YYYY-MM-DD (default: today)",
    )
    parser.add_argument("--league", help="restrict to one competition, e.g. LCK")
    parser.add_argument("--limit", type=int, help="keep at most this many games")
    parser.add_argument(
        "--order",
        choices=("asc", "desc"),
        default="asc",
        help="chronological (default) or newest first",
    )
    parser.add_argument("--out", default="predictor_matches.json", help="output file")
    return build(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
