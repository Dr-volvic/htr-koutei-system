import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateForSummary, computeDashboardStats } from '../src/statsUtils.js';

test('computeDashboardStats includes through items in average and excludes deleted rows', () => {
  const records = [
    { color: '1F7', product: 'RH', durationSec: 100, judgement: '通常', memo: '' },
    { color: '1F7', product: 'RH', durationSec: 20, judgement: 'スルー', memo: '' },
    { color: '1G3', product: 'LH', durationSec: 60, judgement: '通常', memo: '修正' },
    { color: '1F7', product: 'RH', durationSec: 999, judgement: '通常', memo: '[削除] 誤計測' },
  ];

  const stats = computeDashboardStats(records);
  assert.equal(stats.totalCount, 3);
  assert.equal(stats.throughCount, 1);
  assert.equal(stats.normalCount, 2);
  assert.equal(stats.totalSeconds, 180);

  // (100 + 20) / 2 = 60
  assert.equal(stats.matrix['1F7']['RH'].count, 2);
  assert.equal(stats.matrix['1F7']['RH'].throughCount, 1);
  assert.equal(stats.matrix['1F7']['RH'].avgSeconds, 60);

  assert.equal(stats.matrix['1G3']['LH'].count, 1);
  assert.equal(stats.matrix['1G3']['LH'].avgSeconds, 60);
  assert.equal(stats.matrix['4V8']['CTB'].avgSeconds, null);
});

test('aggregateForSummary aggregates active records by color and product', () => {
  const records = [
    { color: '1F7', product: 'RH', judgement: '通常', memo: '' },
    { color: '1F7', product: 'RH', judgement: 'スルー', memo: '' },
    { color: '1F7', product: 'RH', judgement: '通常', memo: '[削除] ミス' },
  ];

  const map = aggregateForSummary(records);
  assert.deepEqual(map.get('1F7__RH'), {
    color: '1F7',
    product: 'RH',
    quantity: 2,
    throughCount: 1,
  });
});
