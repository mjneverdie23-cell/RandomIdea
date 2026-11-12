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
  bag: svg('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  user: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  friend: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M18 8v6M15 11h6"/>'),
  spark: svg('<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z"/>'),
  book: svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/><path d="M8 7h8"/>'),
  screen: svg('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/><path d="M7 8l3 2-3 2M12 12h4"/>'),
  tree: svg('<path d="M12 21v-6"/><path d="M12 3a5 5 0 0 0-4.6 7A4.5 4.5 0 0 0 9 18h6a4.5 4.5 0 0 0 1.6-8A5 5 0 0 0 12 3z"/>'),
  door: svg('<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"/><path d="M3 21h18"/><circle cx="14.5" cy="12.5" r=".9" fill="currentColor"/>'),
  map: svg('<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.6 3.6 5.4 3.6 8.5s-1 5.9-3.6 8.5c-2.6-2.6-3.6-5.4-3.6-8.5s1-5.9 3.6-8.5z"/>'),
  pyramid: svg('<path d="M12 4l9 15H3z"/><path d="M12 4l2.5 15"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  arch: svg('<path d="M4 20V9a8 5 0 0 1 16 0v11"/><path d="M8 20v-6a4 3 0 0 1 8 0v6"/><path d="M3 20h18"/>'),
  torii: svg('<path d="M3 6c4 1.3 14 1.3 18 0"/><path d="M5 10h14"/><path d="M7 7.5V20M17 7.5V20"/>'),
  plane: svg('<path d="M21 4L3 11l6 2.5L11.5 20l3-6 6.5-10z"/><path d="M9 13.5l5-5"/>'),
};

export const EMOTE_ICONS = [ICONS.wave, ICONS.stretch, ICONS.cheer];
