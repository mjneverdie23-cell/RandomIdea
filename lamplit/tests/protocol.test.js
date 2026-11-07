import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeClientMessage as clean, PROTOCOL } from '../shared/protocol.js';
import { displayName, subjectName } from '../shared/words.js';

const hello = { t: 'hello', v: PROTOCOL, name: [0, 0, 7], color: 2, lamp: 0 };

test('valid messages pass and are copied', () => {
  assert.deepEqual(clean(hello), hello);
  assert.deepEqual(clean({ ...hello, hall: 3, resume: 'abcDEF123_-xyz' }), { ...hello, hall: 3, resume: 'abcDEF123_-xyz' });
  assert.deepEqual(clean({ t: 'go', from: [1.234, -2.345], to: [0, 0] }), { t: 'go', from: [1.23, -2.35], to: [0, 0] });
  assert.deepEqual(clean({ t: 'focus', mins: 25, tag: 3 }), { t: 'focus', mins: 25, tag: 3 });
  assert.deepEqual(clean({ t: 'focus', mins: 0, tag: 0 }), { t: 'focus', mins: 0, tag: 0 });
  assert.deepEqual(clean({ t: 'stand', extra: 'ignored' }), { t: 'stand' });
});

test('malformed or hostile messages are rejected', () => {
  const bad = [
    null,
    42,
    'hello',
    [],
    {},
    { t: 'nope' },
    { ...hello, name: [999, 0, 1] },
    { ...hello, name: [0, 0, 0] },
    { ...hello, name: ['<b>', 0, 1] },
    { ...hello, color: 99 },
    { ...hello, resume: 'short' },
    { ...hello, resume: 'has spaces in it!!' },
    { t: 'go', from: [0, 0], to: [500, 0] },
    { t: 'go', from: [0, 0], to: [NaN, 0] },
    { t: 'go', from: [0, 0] },
    { t: 'sit', desk: 100, from: [0, 0] },
    { t: 'sit', desk: -1, from: [0, 0] },
    { t: 'sit', desk: 1.5, from: [0, 0] },
    { t: 'focus', mins: 3, tag: 0 },
    { t: 'focus', mins: 500, tag: 0 },
    { t: 'focus', mins: 25, tag: 42 },
    { t: 'rest', mins: 0 },
    { t: 'emote', e: 9 },
    { t: 'gift', desk: '3' },
    { t: 'ping', c: 'now' },
  ];
  for (const msg of bad) assert.equal(clean(msg), null, JSON.stringify(msg));
});

test('names and subjects are shown in the viewer language', () => {
  assert.equal(displayName([0, 0, 27], 'en'), 'Quiet Owl 27');
  assert.equal(displayName([0, 0, 27], 'ko'), '조용한 부엉이 27');
  assert.equal(subjectName(1, 'en'), 'Math');
  assert.equal(subjectName(1, 'ko'), '수학');
});
