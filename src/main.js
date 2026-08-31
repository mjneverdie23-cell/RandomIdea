/**
 * Browser entry point.
 *
 * Wires the simulation (src/core) to the renderer (src/render), the UI
 * (src/ui), audio (src/audio) and input (src/platform). This file is the only
 * place where those four layers meet - each of them can be replaced on its own.
 */
import { GameManager } from './core/GameManager.js';
import { Renderer } from './render/Renderer.js';
import { HUD } from './ui/HUD.js';
import { ShopUI } from './ui/ShopUI.js';
import { Scoreboard } from './ui/Scoreboard.js';
import { ClassSelectUI } from './ui/ClassSelectUI.js';
import { StartScreen, MatchEndScreen } from './ui/Overlays.js';
import { BrowserInput } from './platform/BrowserInput.js';
import { GameLoop } from './platform/GameLoop.js';
import { AudioManager } from './audio/AudioManager.js';
import { RoundPhase } from './config/gameplay.config.js';
import { GameEvents } from './core/events/GameEvents.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');

let game = createGame();
let renderer = new Renderer({ canvas, game });
let audio = new AudioManager({ bus: game.bus, game });

const hud = new HUD({ root: uiRoot, game });
const shopUI = new ShopUI({ root: uiRoot, game });
const scoreboard = new Scoreboard({ root: uiRoot, game });
const classSelect = new ClassSelectUI({ root: uiRoot, game, onSelect: () => refocus() });
const matchEnd = new MatchEndScreen({ root: uiRoot, game, onRestart: () => restart() });
const startScreen = new StartScreen({
  root: uiRoot,
  onStart: () => beginPlaying(),
  onChooseClass: () => classSelect.toggle(true),
});

function createGame() {
  const params = new URLSearchParams(location.search);
  return new GameManager({
    mapId: params.get('map') ?? undefined,
    seed: params.has('seed') ? Number(params.get('seed')) : undefined,
    playerName: params.get('name') ?? 'You',
    botDifficulty: params.get('difficulty')?.toUpperCase() ?? undefined,
  });
}

const input = new BrowserInput({
  element: canvas,
  getPlayer: () => game.localPlayer,
  actions: {
    toggleShop: () => {
      const phase = game.round.phase;
      if (phase !== RoundPhase.BUY && phase !== RoundPhase.WARMUP) {
        hud.showBanner('Shop closed', 'Buy phase only', 'var(--danger)', 1.2);
        return;
      }
      const open = shopUI.toggle();
      setOverlayMode(open);
    },
    toggleScoreboard: (show) => scoreboard.toggle(show),
    toggleFreeCam: () => renderer.toggleFreeCam(),
    closeOverlays: () => {
      shopUI.toggle(false);
      classSelect.toggle(false);
      scoreboard.toggle(false);
      setOverlayMode(false);
    },
    onPointerLockChange: (locked) => {
      if (!locked && !anyOverlayOpen()) startScreen.show();
    },
  },
});

function anyOverlayOpen() {
  return shopUI.isOpen || classSelect.element.classList.contains('show') ||
    matchEnd.element.classList.contains('show');
}

/** While an overlay owns the mouse the player stops moving/shooting. */
function setOverlayMode(overlayOpen) {
  input.setEnabled(!overlayOpen);
  if (overlayOpen) document.exitPointerLock?.();
  else input.requestPointerLock();
}

function beginPlaying() {
  audio.unlock();
  input.requestPointerLock();
  if (!loop.running) {
    game.start();
    loop.start();
  }
}

function refocus() {
  if (!anyOverlayOpen()) setOverlayMode(false);
}

function restart() {
  loop.stop();
  renderer.dispose();
  matchEnd.hide();

  game = createGame();
  renderer = new Renderer({ canvas, game });
  audio = new AudioManager({ bus: game.bus, game });
  // Rebind the UI to the new game instance.
  for (const ui of [hud, shopUI, scoreboard, classSelect, matchEnd]) ui.game = game;
  hud._bindEvents(game.bus);
  matchEnd.element.classList.remove('show');
  game.bus.on(GameEvents.MATCH_ENDED, (payload) => matchEnd.show(payload));
  game.start();
  loop.start();
  input.requestPointerLock();
}

// Open the shop automatically at the start of each buy phase - a prototype
// convenience so the economy is always visible.
game.bus.on(GameEvents.ROUND_PHASE_CHANGED, ({ phase }) => {
  if (phase === RoundPhase.BUY && !anyOverlayOpen() && loop.running) {
    shopUI.toggle(true);
    setOverlayMode(true);
  }
  if (phase === RoundPhase.LIVE && shopUI.isOpen) {
    shopUI.toggle(false);
    setOverlayMode(false);
  }
});

const debugEnabled = new URLSearchParams(location.search).get('debug') === '1';

const loop = new GameLoop({
  tick: (dt) => game.tick(dt),
  render: (dt) => {
    input.update();
    renderer.update(dt);
    hud.update(dt);
    if (debugEnabled) hud.setDebugText(debugText());
  },
});

// --- debug readout (toggle with the URL flag ?debug=1) -----------------------
function debugText() {
  const player = game.localPlayer;
  const bots = [...game.bots.values()].slice(0, 5).map((b) => `${b.character.name}: ${b.goal}`).join('\n');
  return [
    `fps ${loop.stats.fps}  ticks/frame ${loop.stats.ticksLastFrame}  frame ${loop.stats.frameMs.toFixed(1)}ms`,
    `phase ${game.round.phase}  round ${game.match.roundNumber}  bomb ${game.bomb.state}`,
    player ? `pos ${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)} - ${game.world.map.areaAt(player.position)?.label ?? 'nowhere'}` : '',
    bots,
  ].join('\n');
}

// Expose for console tinkering during development.
window.RAPTOR = { game, renderer, hud, loop, input, audio, shopUI, scoreboard };
