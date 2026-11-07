# Lamplit — study together, in silence

A browser-based online study hall. You walk into a night-time reading room as a little
student, take a free desk, pick how long you want to focus, and **turn on your desk lamp**.
Everyone else in the room is doing the same. You can see their lamps glowing, but there is
**no chat** — just the quiet company of other people working.

It's built for phones as much as desktops: open the link, tap **Enter**, and you're at a
desk in seconds. No app, no account.

![Lamplit on desktop: a reading room full of lit desks](docs/desktop.jpg)

<p align="center"><img src="docs/phone.jpg" width="320" alt="Lamplit on a phone, focusing at a desk"></p>

Lamplit is an original game in the "quiet shared space" genre that online temples such as
Sansa made popular in 2026. It aims that idea at studying and gives people a reason to come
back every day. Its name, setting, characters, art and sound are all its own.

## Quick start

Requires Node.js 22 or newer.

```bash
cd lamplit
npm install
npm start            # http://localhost:8080
```

Open http://localhost:8080 in two browser windows to see two visitors in the same room.

To fill a room with simulated students (useful for demos), raise the per-IP connection
limit first, because every bot connects from the same address:

```bash
MAX_CONN_PER_IP=10000 npm start
npm run bots -- --count 60 --room 1
```

Run the tests (33 tests covering the layout, pathfinding, protocol validation, room logic,
and a real server with real WebSocket clients):

```bash
npm test
```

## How to play

1. **Enter** the reading room. You get a random name from word lists, such as "Quiet Owl 27".
2. **Tap a free desk.** Free desks have a small floating marker. Your student walks over and sits down.
3. Choose a **session length** (25, 50 or 90 minutes, or open-ended) and **what you're working on**.
4. **Turn on the lamp.** Your lamp lights up for everyone in the room, and the timer starts.
5. When the session ends a bell rings. Take a **5-minute break**, start another, or stay.

There's more you can do:

| | |
|---|---|
| **Focus view** | Zooms in on your desk and hides everything except the timer. |
| **Wave, stretch, cheer** | The three buttons at the bottom right (top right on phones). Everyone nearby sees it. |
| **Send a cup of tea** | Tap someone's desk to see what they're working on and leave a cup of tea there. One every 20 seconds. |
| **Your study** | Today's total, streak, all-time total, sessions, the last 7 days and a daily goal. Stored on your device only. |
| **Desk lamps** | New lamp shades unlock at 5, 15, 40 and 100 hours of focus. Everyone sees your lamp. |
| **Rooms** | Each room holds 100 people. Tap the room name to see the others and move. |
| **Languages** | English and Korean; names and subjects appear in each viewer's own language. |
| **Sound** | Rain on the windows, pages and pencils from the people around you (more when more lamps are lit), the lamp's click, and the end-of-session bell. All synthesized, with no audio files. |

### Why there's no chat

Not having chat is the point. It's also why the game needs no moderation: names are picked
from fixed word lists, subjects come from a fixed list, and the only gestures are wave,
stretch, cheer and tea. Nobody can type anything that anyone else sees.

## How it works

```
lamplit/
├── server/
│   ├── index.js        entry point (npm start)
│   ├── app.js          HTTP + WebSocket wiring, per-IP limits, heartbeats, rate limits
│   ├── halls.js        all room logic, independent of sockets (tested directly)
│   ├── static.js       static files with ETags and cached brotli/gzip
│   ├── rate-limit.js   token bucket
│   └── config.js       environment variables
├── shared/             used by both the server and the browser
│   ├── layout.js       room geometry: 100 desks, shelves, walk grid
│   ├── path.js         A* pathfinding with smoothing
│   ├── protocol.js     message types, limits and validation
│   └── words.js        names, subjects, colours, lamps (English + Korean)
├── client/
│   ├── index.html, style.css, icon.svg
│   ├── vendor/three.module.min.js   three.js r169 (MIT)
│   └── js/
│       ├── main.js     ties everything together: state, camera, input, session flow
│       ├── world.js    the room, instanced desks/lamps, lamp glow, clock and board
│       ├── avatars.js  instanced students: walking, sitting, reading, emotes
│       ├── ui.js       header, dock, sheets, toasts
│       ├── net.js      WebSocket with reconnects and server-clock sync
│       ├── audio.js    Web Audio synthesis
│       ├── store.js    local profile and stats (safe when storage is blocked)
│       ├── i18n.js, labels.js, icons.js, textures.js
├── tools/bots.js       simulated visitors for demos and load tests
└── tests/              node --test suites
```

**The server is authoritative.**
- Desks are claimed on the server, so two people can never take the same seat.
- Paths are computed on the server and broadcast. Clients only replay them, so movement costs one message per walk, not a position stream.
- Focus minutes are credited from the server's own clock.
- Every incoming message is validated in `shared/protocol.js`, and the server corrects teleport attempts.

**Rooms and seats.**
- Each room holds up to 100 people, one per desk.
- New visitors join the busiest room that still has space, so rooms feel alive.
- When every room is full, a new one opens, up to `MAX_HALLS`; after that, visitors wait in a queue with their position shown.
- Empty extra rooms close automatically.

**Dropped connections.** Phones lock their screens, so a dropped visitor keeps their desk
and running session for 2 minutes, and reconnecting resumes it (a token kept per tab).
Visitors who never sat down are dropped after 15 seconds, so quick bounces don't fill rooms.

**Network traffic.**
- Room events are batched and sent at most 5 times a second, and only when something happened.
- People sitting at a desk cost nothing.
- Room-wide counts go out every 5 seconds.

**Rendering.**
- Each kind of desk part is drawn once for all 100 desks (instancing).
- Lamp glow is fake light (additive sprites), so a full room of lamps doesn't need 100 real lights.
- Only your own lamp is a real light.
- On slow devices the resolution drops automatically.

### Measured performance

Measured in a 4-vCPU container, with the server and the bots on the same machine:

| | |
|---|---|
| First page load | about **200 KB** compressed in total, including three.js (151 KB brotli) |
| 6,000 simulated students in 61 rooms, steady state | server at about **5–10% of one CPU core**, about **150 bytes/second per student** |
| The same 6,000 joining at 600 per second | server peaks at about 85% of one core; p50 join time 286 ms, p95 730 ms |
| Memory | about 95 MB idle; about 146 MB with 4,000 connected |

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` | |
| `HALL_CAPACITY` | `100` | people per room (at most 100, the number of desks) |
| `MAX_HALLS` | `100` | rooms per server process before visitors queue |
| `MAX_QUEUE` | `5000` | queue length before visitors are turned away |
| `TICK_MS` | `200` | how often room events are sent |
| `MAX_CONN_PER_IP` | `40` | sockets per IP address (schools and offices share addresses) |
| `TRUST_PROXY` | off | set to `1` behind a reverse proxy so `X-Forwarded-For` is used |
| `ALLOWED_ORIGINS` | any | comma-separated list of allowed `Origin` values for the WebSocket |

## Deploying

Any host that runs Node and allows WebSockets will work: a small VPS, Fly.io, Render,
Railway and so on.

1. Put it behind HTTPS so the browser uses `wss://`.
2. Set `TRUST_PROXY=1` if a proxy sits in front.
3. Optionally set `ALLOWED_ORIGINS`.

The server keeps all room state in memory, so one process is one set of rooms, and a restart
resets the room totals. Visitors' own stats live in their browsers and aren't affected.

## Known limits and next steps

- **One process.** Going past one process's rooms (about 10,000 people at the defaults) needs a router that sends each room to a process, with shared room counts (for example in Redis).
- **No accounts.** Stats and streaks are per device. Optional sign-in would let streaks follow people across devices.
- **Background timers.** Browsers slow down timers in background tabs. The server finishes a session on time either way, but the bell can be late if the tab is hidden and muted.
- **Ideas:**
  - seasonal events (a New Year wish hill, exam-season nights)
  - more room themes
  - sponsor slots in the room
  - mini-app versions (Toss, LINE)
  - notifications when a session ends

## License

MIT, same as the rest of this repository. three.js is MIT-licensed
(`client/vendor/THREE_LICENSE.txt`). The `ws` package is MIT-licensed.
