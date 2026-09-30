#!/usr/bin/env bash
# Compiles the engine-free Unreal core with g++ against a small CoreMinimal shim and replays
# the shared rules vectors. Needs python3 and a C++17 compiler; no Unreal Engine required.
set -euo pipefail
cd "$(dirname "$0")"
python3 generate.py
CORE=../../unreal/Source/TacticalShooter/Core
CXX=${CXX:-g++}
$CXX -std=c++17 -O1 -Wall -Wextra -Wshadow -Werror -Wno-unused-parameter \
  -I shim -I "$CORE" -I . \
  main.cpp "$CORE/TSRules.cpp" "$CORE/TSMatchFlow.cpp" "$CORE/TSMapGrid.cpp" "$CORE/TSNavGrid.cpp" \
  "$CORE/TSSynth.cpp" "$CORE/TSGameData.cpp" \
  -o build/ue_core_check
./build/ue_core_check
