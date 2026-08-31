# Web prototype (reference implementation)

The original browser/three.js prototype of Raptor Strike. It is **not** the main
project any more - the Godot 4.7 project at the repository root is - but it is kept
because it still runs, and because its balance data and system logic are the
reference the Godot port was built from.

```bash
cd web-prototype
npm start      # play at http://localhost:5173
npm test       # 86 headless tests
npm run sim    # simulate a full bot match
```

`HANDBOOK.md` in this folder documents this version. The `.gdignore` file keeps
Godot from importing any of it.
