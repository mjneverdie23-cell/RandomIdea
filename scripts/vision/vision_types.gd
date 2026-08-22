class_name VisionTypes
extends RefCounted

## Shared vocabulary for the vision layer, free of gameplay imports.

## Why a vision source exists. Wards see into bushes; units do not.
enum SourceKind { UNIT, WARD, REVEAL }

## What a viewer knows about a unit right now.
enum Visibility { HIDDEN, VISIBLE }

## Bit per team inside the replicated visibility mask.
const TEAM_A_BIT := 1 << 1
const TEAM_B_BIT := 1 << 2
## Bit 0 of the same byte is the alive flag the state sync already sends.
const ALIVE_BIT := 1 << 0


static func team_bit(team: int) -> int:
	return TEAM_A_BIT if team == MapEnums.Team.A else TEAM_B_BIT
