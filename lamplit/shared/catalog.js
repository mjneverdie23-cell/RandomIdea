// The shop catalogue and the "look" (what an avatar wears), shared by server and client.
//
// Prices are in lumens (✦). You earn 1 lumen for every minute your lamp is on, plus a
// bonus for finishing a timed session. There is no real-money payment anywhere.

import { SWEATERS, LAMPS } from './words.js';

export const WELCOME_LUMENS = 100;
export const COMPLETE_BONUS = 10;
export const CATEGORIES = ['clothes', 'accessories', 'pets', 'held'];

/** Look keys: o = outfit, c = sweater colour, l = lamp shade, then one item per slot. */
export const SLOTS = ['o', 'hat', 'face', 'ears', 'neck', 'held', 'pet'];

export const ITEMS = [
  // Clothes. `tint` outfits take your chosen sweater colour.
  { id: 'sweater', cat: 'clothes', slot: 'o', price: 0, tint: true, en: 'Sweater', ko: '스웨터' },
  { id: 'hoodie', cat: 'clothes', slot: 'o', price: 150, tint: true, en: 'Hoodie', ko: '후드티' },
  { id: 'cardigan', cat: 'clothes', slot: 'o', price: 180, tint: true, en: 'Cardigan', ko: '카디건' },
  { id: 'stripes', cat: 'clothes', slot: 'o', price: 200, en: 'Striped tee', ko: '줄무늬 티' },
  { id: 'jersey', cat: 'clothes', slot: 'o', price: 220, tint: true, en: 'Team jersey', ko: '팀 저지' },
  { id: 'pajamas', cat: 'clothes', slot: 'o', price: 240, en: 'Pajamas', ko: '잠옷' },
  { id: 'raincoat', cat: 'clothes', slot: 'o', price: 260, en: 'Raincoat', ko: '우비' },
  { id: 'overalls', cat: 'clothes', slot: 'o', price: 280, en: 'Overalls', ko: '멜빵바지' },
  { id: 'blazer', cat: 'clothes', slot: 'o', price: 320, en: 'School blazer', ko: '교복 블레이저' },
  // Accessories, one per slot.
  { id: 'bowtie', cat: 'accessories', slot: 'neck', price: 80, en: 'Bow tie', ko: '나비넥타이' },
  { id: 'glasses', cat: 'accessories', slot: 'face', price: 90, en: 'Round glasses', ko: '동그란 안경' },
  { id: 'scarf', cat: 'accessories', slot: 'neck', price: 110, en: 'Scarf', ko: '목도리' },
  { id: 'beanie', cat: 'accessories', slot: 'hat', price: 120, en: 'Beanie', ko: '비니' },
  { id: 'sunglasses', cat: 'accessories', slot: 'face', price: 130, en: 'Sunglasses', ko: '선글라스' },
  { id: 'beret', cat: 'accessories', slot: 'hat', price: 140, en: 'Beret', ko: '베레모' },
  { id: 'nightcap', cat: 'accessories', slot: 'hat', price: 160, en: 'Nightcap', ko: '수면 모자' },
  { id: 'catears', cat: 'accessories', slot: 'ears', price: 180, en: 'Cat ears', ko: '고양이 귀' },
  { id: 'bunnyears', cat: 'accessories', slot: 'ears', price: 200, en: 'Bunny ears', ko: '토끼 귀' },
  { id: 'flowers', cat: 'accessories', slot: 'hat', price: 220, en: 'Flower crown', ko: '꽃 화관' },
  { id: 'headphones', cat: 'accessories', slot: 'ears', price: 250, en: 'Headphones', ko: '헤드폰' },
  { id: 'gradcap', cat: 'accessories', slot: 'hat', price: 400, en: 'Graduation cap', ko: '학사모' },
  { id: 'crown', cat: 'accessories', slot: 'hat', price: 900, en: 'Little crown', ko: '작은 왕관' },
  // Pets.
  { id: 'hamster', cat: 'pets', slot: 'pet', price: 400, en: 'Hamster', ko: '햄스터' },
  { id: 'turtle', cat: 'pets', slot: 'pet', price: 450, en: 'Turtle', ko: '거북이' },
  { id: 'bunny', cat: 'pets', slot: 'pet', price: 550, en: 'Bunny', ko: '토끼' },
  { id: 'cat', cat: 'pets', slot: 'pet', price: 600, en: 'Cat', ko: '고양이' },
  { id: 'puppy', cat: 'pets', slot: 'pet', price: 650, en: 'Puppy', ko: '강아지' },
  { id: 'owlet', cat: 'pets', slot: 'pet', price: 700, en: 'Owlet', ko: '아기 부엉이' },
  // Things to hold (they move to the desk when you sit down).
  { id: 'flashcards', cat: 'held', slot: 'held', price: 50, en: 'Flashcards', ko: '단어 카드' },
  { id: 'book', cat: 'held', slot: 'held', price: 60, en: 'Novel', ko: '소설책' },
  { id: 'coffee', cat: 'held', slot: 'held', price: 70, en: 'Coffee', ko: '커피' },
  { id: 'comic', cat: 'held', slot: 'held', price: 80, en: 'Comic book', ko: '만화책' },
  { id: 'bubbletea', cat: 'held', slot: 'held', price: 90, en: 'Bubble tea', ko: '버블티' },
  { id: 'textbooks', cat: 'held', slot: 'held', price: 100, en: 'Textbooks', ko: '교과서' },
  { id: 'plushie', cat: 'held', slot: 'held', price: 160, en: 'Teddy bear', ko: '곰인형' },
  { id: 'globe', cat: 'held', slot: 'held', price: 220, en: 'Globe', ko: '지구본' },
  { id: 'tablet', cat: 'held', slot: 'held', price: 250, en: 'Tablet', ko: '태블릿' },
  { id: 'laptop', cat: 'held', slot: 'held', price: 350, en: 'Laptop', ko: '노트북' },
];

/** id -> item. No prototype, so ids like "__proto__" or "constructor" are simply unknown. */
export const ITEM = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(ITEMS.map((it) => [it.id, Object.freeze(it)]))));

export const isItem = (id) => typeof id === 'string' && Object.hasOwn(ITEM, id);

export function defaultLook(color = 0) {
  return { o: 'sweater', c: color, l: 0, hat: null, face: null, ears: null, neck: null, held: null, pet: null };
}

/** A clean, valid look from anything (e.g. a stored or received object). */
export function sanitizeLook(raw) {
  const look = defaultLook();
  if (!raw || typeof raw !== 'object') return look;
  if (Number.isInteger(raw.c) && raw.c >= 0 && raw.c < SWEATERS.length) look.c = raw.c;
  if (Number.isInteger(raw.l) && raw.l >= 0 && raw.l < LAMPS.length) look.l = raw.l;
  for (const slot of SLOTS) {
    const it = ITEM[raw[slot]];
    if (it && it.slot === slot) look[slot] = it.id;
  }
  if (!look.o) look.o = 'sweater';
  return look;
}

export function lumensFor(minutes, completed) {
  return Math.max(0, Math.floor(minutes)) + (completed ? COMPLETE_BONUS : 0);
}

export function itemName(id, lang = 'en') {
  const it = ITEM[id];
  return it ? (it[lang] ?? it.en) : id;
}
