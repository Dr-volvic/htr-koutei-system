import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDatePattern,
  formatDateWithPattern,
  formatTimeHms,
  generateRecordId,
  normalizeDateKey,
} from '../src/dateUtils.js';

test('detectDatePattern and formatDateWithPattern match various sheet formats', () => {
  const sampleDate = new Date('2026-01-05T15:30:12+09:00');

  const pSlashPad = detectDatePattern('2026/11/19');
  assert.equal(formatDateWithPattern(sampleDate, pSlashPad), '2026/01/05');

  const pSlashNoPad = detectDatePattern('2026/1/5');
  assert.equal(formatDateWithPattern(sampleDate, pSlashNoPad), '2026/1/5');

  const pDash = detectDatePattern('2026-11-19');
  assert.equal(formatDateWithPattern(sampleDate, pDash), '2026-01-05');

  const pMd = detectDatePattern('1/5');
  assert.equal(formatDateWithPattern(sampleDate, pMd), '1/5');

  const pJp = detectDatePattern('2026年1月5日');
  assert.equal(formatDateWithPattern(sampleDate, pJp), '2026年1月5日');
});

test('normalizeDateKey normalizes padded and unpadded dates consistently', () => {
  assert.equal(normalizeDateKey('2026/1/5'), '2026-01-05');
  assert.equal(normalizeDateKey('2026/01/05'), '2026-01-05');
  assert.equal(normalizeDateKey('2026-1-5'), '2026-01-05');
  assert.equal(normalizeDateKey('1/5', '2026'), '2026-01-05');
});

test('generateRecordId produces unique sequential IDs for same second', () => {
  const dt = new Date('2026-11-19T15:30:12+09:00');
  const id1 = generateRecordId(dt, []);
  assert.equal(id1, '20261119-153012-001');

  const id2 = generateRecordId(dt, ['20261119-153012-001']);
  assert.equal(id2, '20261119-153012-002');
});

test('formatTimeHms formats JST HH:mm:ss', () => {
  const dt = new Date('2026-11-19T00:05:09+09:00');
  assert.equal(formatTimeHms(dt), '00:05:09');
});
