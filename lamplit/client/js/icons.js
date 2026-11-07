// Inline SVG icons (24x24, stroked with currentColor).

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  lamp: svg('<path d="M5 11h14l-2.5-5h-9z"/><path d="M12 11v7"/><path d="M8 20h8"/>'),
  room: svg('<path d="M6 21V4h12v17"/><path d="M3 21h18"/><circle cx="14.5" cy="12.5" r=".9" fill="currentColor"/>'),
  chart: svg('<path d="M5 20V11"/><path d="M12 20V5"/><path d="M19 20v-6"/><path d="M3 20h18"/>'),
  sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  soundOn: svg('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  wave: svg('<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V12"/><path d="M17 10.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.6l-2.8-4.2a1.5 1.5 0 0 1 2.5-1.7L8 14"/>'),
  stretch: svg('<circle cx="12" cy="5" r="2"/><path d="M5 3.5l4 5.5h6l4-5.5"/><path d="M12 9v5.5M9 21l3-6.5 3 6.5"/>'),
  cheer: svg('<path d="M12 3l2.1 5.4 5.9.4-4.5 3.8 1.4 5.8L12 15.3l-4.9 3.1 1.4-5.8L4 8.8l5.9-.4z"/>'),
  tea: svg('<path d="M4 10h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11.5h1.5a2.3 2.3 0 0 1 0 4.6H17"/><path d="M8 3.5c0 1.4 1 1.4 1 2.8M12 3.5c0 1.4 1 1.4 1 2.8"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  focus: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  reroll: svg('<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
};

export const EMOTE_ICONS = [ICONS.wave, ICONS.stretch, ICONS.cheer];
