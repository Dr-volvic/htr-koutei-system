import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetsService } from '../src/sheetsClient.js';

function createMockSheetsApi(initialSheets = {}) {
  const sheets = {
    '700B集計': initialSheets['700B集計'] ? [...initialSheets['700B集計'].map((r) => [...r])] : [],
    '700Bデータ': initialSheets['700Bデータ'] ? [...initialSheets['700Bデータ'].map((r) => [...r])] : [],
  };

  function parseRange(range) {
    const [sheetName, cellRange] = range.split('!');
    return { sheetName, cellRange };
  }

  function colToIdx(col) {
    return col.charCodeAt(0) - 'A'.charCodeAt(0);
  }

  return {
    _sheets: sheets,
    spreadsheets: {
      values: {
        async get({ range }) {
          const { sheetName, cellRange } = parseRange(range);
          const rows = sheets[sheetName] || [];
          if (cellRange === 'A1:I1') {
            return { data: { values: rows.length > 0 ? [rows[0].slice(0, 9)] : [] } };
          }
          return { data: { values: rows.map((r) => [...r]) } };
        },
        async update({ range, requestBody }) {
          const { sheetName, cellRange } = parseRange(range);
          const rows = sheets[sheetName];
          const m = cellRange.match(/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
          const startCol = colToIdx(m[1]);
          const startRow = Number(m[2]) - 1;
          const values = requestBody.values;
          for (let r = 0; r < values.length; r += 1) {
            while (rows.length <= startRow + r) rows.push([]);
            for (let c = 0; c < values[r].length; c += 1) {
              rows[startRow + r][startCol + c] = values[r][c];
            }
          }
          return { data: {} };
        },
        async append({ range, requestBody }) {
          const { sheetName } = parseRange(range);
          const rows = sheets[sheetName];
          for (const row of requestBody.values) {
            rows.push([...row]);
          }
          return { data: {} };
        },
      },
    },
  };
}

test('SheetsService writes log header, matches date format, records completions, and syncs edits/deletes', async () => {
  const mockApi = createMockSheetsApi({
    '700B集計': [],
    '700Bデータ': [
      ['工程', '日付', 'COLOR', '製品', '数量', 'スルー数'],
      ['MIGAKI', '2026/11/18', '1F7', 'RH', 5, 1],
    ],
  });

  const svc = new SheetsService({ sheetsApi: mockApi, spreadsheetId: 'test-id' });
  const now = new Date('2026-11-19T15:30:12+09:00');

  // 1. Initial read ensures header on 700B集計
  const initial = await svc.getTodayState(now);
  assert.equal(initial.dateString, '2026/11/19');
  assert.equal(mockApi._sheets['700B集計'][0][0], 'ID');
  assert.equal(mockApi._sheets['700B集計'][0][8], '修正フラグ・メモ');

  // 2. Record normal completion
  const rec1 = await svc.recordCompletion(
    {
      color: '1F7',
      product: 'RH',
      startTime: '15:29:00',
      endTime: '15:30:12',
      durationSec: 72,
      isThrough: false,
    },
    now
  );
  assert.equal(rec1.id, '20261119-153012-001');
  assert.deepEqual(mockApi._sheets['700Bデータ'][2], [
    'MIGAKI',
    '2026/11/19',
    '1F7',
    'RH',
    1,
    0,
  ]);

  // 3. Record quick through completion (same second -> -002)
  const rec2 = await svc.recordCompletion(
    {
      color: '1F7',
      product: 'RH',
      startTime: '15:30:10',
      endTime: '15:30:12',
      durationSec: 2,
      isThrough: true,
    },
    now
  );
  assert.equal(rec2.id, '20261119-153012-002');
  assert.deepEqual(mockApi._sheets['700Bデータ'][2], [
    'MIGAKI',
    '2026/11/19',
    '1F7',
    'RH',
    2,
    1,
  ]);

  // 4. Edit rec1 from 1F7/RH to 1G3/LH -> both 1F7/RH and 1G3/LH in 700Bデータ should sync
  await svc.updateRecord(
    rec1.id,
    {
      color: '1G3',
      product: 'LH',
      durationSec: 80,
      isThrough: false,
      memo: '色押し間違い',
    },
    now
  );

  // 1F7/RH should now have qty=1, through=1
  assert.deepEqual(mockApi._sheets['700Bデータ'][2], [
    'MIGAKI',
    '2026/11/19',
    '1F7',
    'RH',
    1,
    1,
  ]);
  // 1G3/LH should be added with qty=1, through=0
  assert.deepEqual(mockApi._sheets['700Bデータ'][3], [
    'MIGAKI',
    '2026/11/19',
    '1G3',
    'LH',
    1,
    0,
  ]);

  // 5. Delete rec2 -> marked [削除] in Col I, and 700Bデータ 1F7/RH becomes 0, 0
  await svc.deleteRecord(rec2.id, { memo: 'テスト削除' }, now);
  assert.equal(mockApi._sheets['700B集計'][2][8], '[削除] テスト削除');
  assert.deepEqual(mockApi._sheets['700Bデータ'][2], [
    'MIGAKI',
    '2026/11/19',
    '1F7',
    'RH',
    0,
    0,
  ]);

  // 6. Manual add -> adds record with memo and syncs 700Bデータ
  await svc.addManualRecord(
    {
      color: '4V8',
      product: 'CTB',
      durationSec: 95,
      isThrough: false,
      memo: '押し忘れ',
    },
    now
  );
  assert.deepEqual(mockApi._sheets['700Bデータ'][4], [
    'MIGAKI',
    '2026/11/19',
    '4V8',
    'CTB',
    1,
    0,
  ]);

  // 7. Today state should show 2 active records (newest first)
  const finalState = await svc.getTodayState(now);
  assert.equal(finalState.records.length, 2);
  assert.equal(finalState.stats.totalCount, 2);
  assert.equal(finalState.stats.totalSeconds, 175);
});
