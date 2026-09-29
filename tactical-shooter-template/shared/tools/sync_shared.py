#!/usr/bin/env python3
"""Copies shared/config and shared/maps into both engine projects.

    python3 shared/tools/sync_shared.py          # copy
    python3 shared/tools/sync_shared.py --check  # exit 1 if an engine copy is stale

`shared/` is the single source of truth. Each engine reads its own copy at runtime
(Unity: Resources/TacticalShooter, Unreal: Content/Data) because neither engine can
read files outside its project folder in a packaged build.
"""
import filecmp
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHARED = os.path.join(ROOT, "shared")
TARGETS = {
    "unity": os.path.join(ROOT, "unity", "Assets", "TacticalShooter", "Resources", "TacticalShooter"),
    "unreal": os.path.join(ROOT, "unreal", "Content", "Data"),
}
FOLDERS = {"config": "Config", "maps": "Maps"}


def main():
    check = "--check" in sys.argv
    stale = []
    for engine, target in TARGETS.items():
        for src_name, dst_name in FOLDERS.items():
            src_dir = os.path.join(SHARED, src_name)
            dst_dir = os.path.join(target, dst_name)
            wanted = sorted(f for f in os.listdir(src_dir) if f.endswith(".json"))
            existing = sorted(f for f in os.listdir(dst_dir) if f.endswith(".json")) if os.path.isdir(dst_dir) else []
            for f in wanted:
                src, dst = os.path.join(src_dir, f), os.path.join(dst_dir, f)
                if not os.path.exists(dst) or not filecmp.cmp(src, dst, shallow=False):
                    stale.append(f"{engine}: {dst_name}/{f}")
                    if not check:
                        os.makedirs(dst_dir, exist_ok=True)
                        shutil.copyfile(src, dst)
            for f in existing:
                if f not in wanted:
                    stale.append(f"{engine}: {dst_name}/{f} (not in shared)")
                    if not check:
                        os.remove(os.path.join(dst_dir, f))
    if check:
        if stale:
            print("Engine copies are out of date. Run: python3 shared/tools/sync_shared.py")
            for s in stale:
                print("  " + s)
            return 1
        print("Engine copies match shared/.")
        return 0
    print("Synced." if stale else "Already in sync.")
    for s in stale:
        print("  updated " + s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
