// Localised word lists. Visitors never type names or messages: a name is a pair of
// indexes into these lists plus a number, so nothing anyone sees needs moderating, and
// each viewer reads every name in their own language.

export const ADJECTIVES = [
  { en: 'Quiet', ko: '조용한' },
  { en: 'Sleepy', ko: '졸린' },
  { en: 'Gentle', ko: '다정한' },
  { en: 'Brave', ko: '용감한' },
  { en: 'Calm', ko: '차분한' },
  { en: 'Curious', ko: '궁금한' },
  { en: 'Steady', ko: '꾸준한' },
  { en: 'Bright', ko: '빛나는' },
  { en: 'Cozy', ko: '포근한' },
  { en: 'Humble', ko: '겸손한' },
  { en: 'Clever', ko: '영리한' },
  { en: 'Diligent', ko: '부지런한' },
  { en: 'Kind', ko: '친절한' },
  { en: 'Soft', ko: '말랑한' },
  { en: 'Warm', ko: '따뜻한' },
  { en: 'Tiny', ko: '작은' },
  { en: 'Busy', ko: '바쁜' },
  { en: 'Focused', ko: '집중한' },
  { en: 'Hopeful', ko: '희망찬' },
  { en: 'Silent', ko: '고요한' },
  { en: 'Lucky', ko: '운 좋은' },
  { en: 'Sunny', ko: '화창한' },
  { en: 'Mellow', ko: '느긋한' },
  { en: 'Patient', ko: '참을성 있는' },
];

export const ANIMALS = [
  { en: 'Owl', ko: '부엉이' },
  { en: 'Fox', ko: '여우' },
  { en: 'Otter', ko: '수달' },
  { en: 'Cat', ko: '고양이' },
  { en: 'Rabbit', ko: '토끼' },
  { en: 'Bear', ko: '곰' },
  { en: 'Deer', ko: '사슴' },
  { en: 'Panda', ko: '판다' },
  { en: 'Hedgehog', ko: '고슴도치' },
  { en: 'Penguin', ko: '펭귄' },
  { en: 'Squirrel', ko: '다람쥐' },
  { en: 'Turtle', ko: '거북이' },
  { en: 'Koala', ko: '코알라' },
  { en: 'Seal', ko: '물범' },
  { en: 'Sparrow', ko: '참새' },
  { en: 'Whale', ko: '고래' },
  { en: 'Puppy', ko: '강아지' },
  { en: 'Duck', ko: '오리' },
  { en: 'Lamb', ko: '아기 양' },
  { en: 'Hamster', ko: '햄스터' },
  { en: 'Raccoon', ko: '너구리' },
  { en: 'Crane', ko: '두루미' },
  { en: 'Frog', ko: '개구리' },
  { en: 'Tiger', ko: '호랑이' },
];

/** What a visitor says they are working on (shown when someone taps their desk). */
export const SUBJECTS = [
  { en: 'Exam prep', ko: '시험 준비' },
  { en: 'Math', ko: '수학' },
  { en: 'Science', ko: '과학' },
  { en: 'Languages', ko: '어학' },
  { en: 'Reading', ko: '독서' },
  { en: 'Writing', ko: '글쓰기' },
  { en: 'Coding', ko: '코딩' },
  { en: 'Work', ko: '업무' },
  { en: 'Art & design', ko: '예술·디자인' },
  { en: 'Something else', ko: '기타' },
];

/** Sweater colours for avatars. */
export const SWEATERS = [
  0xe76f51, 0xf4a261, 0xe9c46a, 0x8ab17d, 0x2a9d8f, 0x4ea8de,
  0x5e60ce, 0x9d4edd, 0xf28482, 0xcdb4db, 0xe8e2d0, 0x6c757d,
];

/**
 * Desk-lamp shades. Better ones unlock with total focus hours (tracked on the visitor's
 * own device), so a lamp quietly shows how long someone has been coming.
 */
export const LAMPS = [
  { shade: 0x1f6b4f, hours: 0, en: 'Library green', ko: '도서관 초록' },
  { shade: 0x9a6b2f, hours: 5, en: 'Brass', ko: '황동' },
  { shade: 0x2f5f9a, hours: 15, en: 'Midnight blue', ko: '자정 파랑' },
  { shade: 0xa8445c, hours: 40, en: 'Rosewood', ko: '로즈우드' },
  { shade: 0xd8b04a, hours: 100, en: 'Gold', ko: '금빛' },
];

export const EMOTES = ['wave', 'stretch', 'cheer'];

export function displayName(name, lang = 'en') {
  const [a, b, n] = name;
  const adj = ADJECTIVES[a] ?? ADJECTIVES[0];
  const animal = ANIMALS[b] ?? ANIMALS[0];
  return `${adj[lang] ?? adj.en} ${animal[lang] ?? animal.en} ${n}`;
}

export function subjectName(tag, lang = 'en') {
  const s = SUBJECTS[tag] ?? SUBJECTS[SUBJECTS.length - 1];
  return s[lang] ?? s.en;
}

export function randomName(random = Math.random) {
  return [
    Math.floor(random() * ADJECTIVES.length),
    Math.floor(random() * ANIMALS.length),
    1 + Math.floor(random() * 99),
  ];
}
