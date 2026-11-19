/**
 * 700B ポリッシング作業記録アプリ（MIGAKI） - Google Apps Script バックエンド
 *
 * 【スクリプトプロパティ設定項目】
 * - SPREADSHEET_ID : 対象スプレッドシート「MASTER_OF_SCHEDULE」のID
 * - ACCESS_TOKEN   : アプリから送信する合言葉（PIN / トークン）
 */

const COLORS = ['1F7', '1G3', '4V8'];
const PRODUCTS = ['RH', 'LH', 'No1', 'CTB'];
const PROCESS_NAME = 'MIGAKI';
const SHEET_LOG = '700B集計';
const SHEET_SUMMARY = '700Bデータ';
const LOG_HEADERS = [
  'ID',
  '日付',
  '開始時刻',
  '終了時刻',
  '作業時間(秒)',
  'COLOR',
  '製品',
  'スルー判定',
  '修正フラグ・メモ',
];
const SUMMARY_HEADERS = ['工程', '日付', 'COLOR', '製品', '数量', 'スルー数'];
const JUDGE_NORMAL = '通常';
const JUDGE_THROUGH = 'スルー';
const DELETE_MARKER = '[削除]';

/**
 * 疎通確認用（データは返しません）
 */
function doGet() {
  return jsonResponse_({
    ok: true,
    service: '700B MIGAKI GAS API',
    timestamp: new Date().toISOString(),
  });
}

/**
 * メインAPIエンドポイント（CORSプリフライト回避のため text/plain JSON を受け取る）
 */
function doPost(e) {
  try {
    const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(rawBody);
    const props = PropertiesService.getScriptProperties();
    const spreadsheetId = props.getProperty('SPREADSHEET_ID') || '';
    const expectedToken = props.getProperty('ACCESS_TOKEN') || '';

    if (!spreadsheetId || !expectedToken) {
      return jsonResponse_({
        ok: false,
        code: 'SERVER_NOT_CONFIGURED',
        error: 'GAS側のスクリプトプロパティ（SPREADSHEET_ID / ACCESS_TOKEN）が未設定です。',
      });
    }

    if (!body.token || body.token !== expectedToken) {
      return jsonResponse_({
        ok: false,
        code: 'UNAUTHORIZED',
        error: '合言葉（PIN）が正しくありません。',
      });
    }

    const action = body.action;
    if (action === 'getToday') {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const state = getTodayState_(ss, new Date());
      return jsonResponse_(Object.assign({ ok: true }, state));
    }

    // 書き込み系はスクリプトロックで直列化
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const now = new Date();

      if (action === 'createRecord') {
        validateColorAndProduct_(body.color, body.product);
        const result = recordCompletion_(ss, body, now);
        return jsonResponse_(Object.assign({ ok: true }, result));
      }

      if (action === 'createManualRecord') {
        validateColorAndProduct_(body.color, body.product);
        const result = addManualRecord_(ss, body, now);
        return jsonResponse_(Object.assign({ ok: true }, result));
      }

      if (action === 'updateRecord') {
        validateColorAndProduct_(body.color, body.product);
        const result = updateRecord_(ss, body.id, body, now);
        return jsonResponse_(Object.assign({ ok: true }, result));
      }

      if (action === 'deleteRecord') {
        const result = deleteRecord_(ss, body.id, body, now);
        return jsonResponse_(Object.assign({ ok: true }, result));
      }

      return jsonResponse_({
        ok: false,
        code: 'BAD_REQUEST',
        error: '不明なactionです: ' + action,
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse_({
      ok: false,
      code: 'INTERNAL_ERROR',
      error: err && err.message ? err.message : String(err),
    });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function validateColorAndProduct_(color, product) {
  if (COLORS.indexOf(color) === -1) {
    throw new Error('COLORが不正です: ' + color);
  }
  if (PRODUCTS.indexOf(product) === -1) {
    throw new Error('製品が不正です: ' + product);
  }
}

function ensureLogHeader_(logSheet) {
  if (logSheet.getLastRow() === 0) {
    logSheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    return;
  }
  const firstRow = logSheet.getRange(1, 1, 1, LOG_HEADERS.length).getDisplayValues()[0];
  const isEmpty = firstRow.every(function (cell) {
    return String(cell || '').trim() === '';
  });
  if (isEmpty) {
    logSheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
  }
}

function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function getJstParts_(dateObj) {
  const tz = 'Asia/Tokyo';
  const yyyy = Utilities.formatDate(dateObj, tz, 'yyyy');
  const yy = Utilities.formatDate(dateObj, tz, 'yy');
  const mm = Utilities.formatDate(dateObj, tz, 'MM');
  const dd = Utilities.formatDate(dateObj, tz, 'dd');
  const hh = Utilities.formatDate(dateObj, tz, 'HH');
  const min = Utilities.formatDate(dateObj, tz, 'mm');
  const ss = Utilities.formatDate(dateObj, tz, 'ss');
  return {
    yyyy: yyyy,
    yy: yy,
    mm: mm,
    dd: dd,
    m: String(Number(mm)),
    d: String(Number(dd)),
    hh: hh,
    min: min,
    ss: ss,
  };
}

function formatTimeHms_(dateObj) {
  const p = getJstParts_(dateObj);
  return p.hh + ':' + p.min + ':' + p.ss;
}

function detectDatePattern_(sample) {
  const raw = String(sample || '').trim();
  if (!raw) {
    return { type: 'ymd', sep: '/', padMonth: true, padDay: true, yearDigits: 4 };
  }

  let m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    return {
      type: 'jp',
      padMonth: m[2].length === 2 && m[2].charAt(0) === '0',
      padDay: m[3].length === 2 && m[3].charAt(0) === '0',
      yearDigits: 4,
    };
  }

  m = raw.match(/^(\d{2,4})([/-])(\d{1,2})\2(\d{1,2})$/);
  if (m) {
    return {
      type: 'ymd',
      sep: m[2],
      yearDigits: m[1].length === 2 ? 2 : 4,
      padMonth: m[3].length === 2,
      padDay: m[4].length === 2,
    };
  }

  m = raw.match(/^(\d{1,2})([/-])(\d{1,2})$/);
  if (m) {
    return {
      type: 'md',
      sep: m[2],
      padMonth: m[1].length === 2,
      padDay: m[3].length === 2,
    };
  }

  return { type: 'ymd', sep: '/', padMonth: true, padDay: true, yearDigits: 4 };
}

function formatDateWithPattern_(dateObj, pattern) {
  const p = getJstParts_(dateObj);
  const pat = pattern || { type: 'ymd', sep: '/', padMonth: true, padDay: true, yearDigits: 4 };
  const mStr = pat.padMonth ? p.mm : p.m;
  const dStr = pat.padDay ? p.dd : p.d;

  if (pat.type === 'jp') {
    return p.yyyy + '年' + mStr + '月' + dStr + '日';
  }
  if (pat.type === 'md') {
    return mStr + pat.sep + dStr;
  }
  const yStr = pat.yearDigits === 2 ? p.yy : p.yyyy;
  return yStr + pat.sep + mStr + pat.sep + dStr;
}

function pad2_(str) {
  return str.length === 1 ? '0' + str : str;
}

function normalizeDateKey_(rawValue, fallbackYear) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  let m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  }

  m = raw.match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const year = m[1].length === 2 ? '20' + m[1] : m[1];
    return year + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  }

  m = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const y = fallbackYear || getJstParts_(new Date()).yyyy;
    return y + '-' + pad2_(m[1]) + '-' + pad2_(m[2]);
  }

  return raw;
}

function generateRecordId_(dateObj, existingIds) {
  const p = getJstParts_(dateObj);
  const prefix = p.yyyy + p.mm + p.dd + '-' + p.hh + p.min + p.ss;
  const existingSet = {};
  for (let i = 0; i < existingIds.length; i += 1) {
    existingSet[existingIds[i]] = true;
  }
  let seq = 1;
  while (true) {
    const seqStr = String(seq);
    const padded =
      seqStr.length === 1 ? '00' + seqStr : seqStr.length === 2 ? '0' + seqStr : seqStr;
    const candidate = prefix + '-' + padded;
    if (!existingSet[candidate]) return candidate;
    seq += 1;
  }
}

function extractDatePatternFromSummaryRows_(summaryRows) {
  let sample = '';
  for (let i = summaryRows.length - 1; i >= 0; i -= 1) {
    const colB = String(summaryRows[i][1] || '').trim();
    if (colB && colB !== '日付' && /\d/.test(colB)) {
      sample = colB;
      break;
    }
  }
  return detectDatePattern_(sample);
}

function readAllLogRows_(logSheet) {
  const lastRow = logSheet.getLastRow();
  if (lastRow === 0) return [];
  const rows = logSheet.getRange(1, 1, lastRow, 9).getDisplayValues();
  const parsed = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const id = String(row[0] || '').trim();
    if (i === 0 && id === 'ID') continue;
    if (!id) continue;
    parsed.push({
      rowIndex: i + 1,
      id: id,
      date: String(row[1] || '').trim(),
      startTime: String(row[2] || '').trim(),
      endTime: String(row[3] || '').trim(),
      durationSec: Number(row[4] || 0) || 0,
      color: String(row[5] || '').trim(),
      product: String(row[6] || '').trim(),
      judgement: String(row[7] || '').trim() || JUDGE_NORMAL,
      memo: String(row[8] || '').trim(),
    });
  }
  return parsed;
}

function readSummaryRows_(summarySheet) {
  const lastRow = summarySheet.getLastRow();
  if (lastRow === 0) return [];
  return summarySheet.getRange(1, 1, lastRow, 6).getDisplayValues();
}

function isRowDeleted_(memo) {
  return String(memo || '').trim().indexOf(DELETE_MARKER) === 0;
}

function computeDashboardStats_(activeRecords) {
  let totalSeconds = 0;
  let throughCount = 0;
  const matrix = {};

  for (let c = 0; c < COLORS.length; c += 1) {
    const color = COLORS[c];
    matrix[color] = {};
    for (let p = 0; p < PRODUCTS.length; p += 1) {
      matrix[color][PRODUCTS[p]] = {
        count: 0,
        throughCount: 0,
        totalSeconds: 0,
        avgSeconds: null,
      };
    }
  }

  for (let i = 0; i < activeRecords.length; i += 1) {
    const rec = activeRecords[i];
    const sec = Math.max(0, Number(rec.durationSec) || 0);
    const isThrough = rec.judgement === JUDGE_THROUGH;
    totalSeconds += sec;
    if (isThrough) throughCount += 1;

    if (matrix[rec.color] && matrix[rec.color][rec.product]) {
      const cell = matrix[rec.color][rec.product];
      cell.count += 1;
      cell.totalSeconds += sec;
      if (isThrough) cell.throughCount += 1;
    }
  }

  for (let c = 0; c < COLORS.length; c += 1) {
    for (let p = 0; p < PRODUCTS.length; p += 1) {
      const cell = matrix[COLORS[c]][PRODUCTS[p]];
      if (cell.count > 0) {
        cell.avgSeconds = Math.round(cell.totalSeconds / cell.count);
      }
    }
  }

  return {
    totalSeconds: totalSeconds,
    totalCount: activeRecords.length,
    throughCount: throughCount,
    normalCount: activeRecords.length - throughCount,
    matrix: matrix,
  };
}

function buildTodayState_(allLogs, dateFormatted, todayKey, fallbackYear) {
  const activeToday = [];
  for (let i = 0; i < allLogs.length; i += 1) {
    const r = allLogs[i];
    if (normalizeDateKey_(r.date, fallbackYear) === todayKey && !isRowDeleted_(r.memo)) {
      activeToday.push(r);
    }
  }
  const stats = computeDashboardStats_(activeToday);
  return {
    dateString: dateFormatted,
    todayKey: todayKey,
    records: activeToday.slice().reverse(),
    stats: stats,
  };
}

function getTodayState_(ss, now) {
  const logSheet = getOrCreateSheet_(ss, SHEET_LOG, LOG_HEADERS);
  ensureLogHeader_(logSheet);
  const summarySheet = getOrCreateSheet_(ss, SHEET_SUMMARY, SUMMARY_HEADERS);

  const summaryRows = readSummaryRows_(summarySheet);
  const datePattern = extractDatePatternFromSummaryRows_(summaryRows);
  const jst = getJstParts_(now);
  const todayFormatted = formatDateWithPattern_(now, datePattern);
  const todayKey = normalizeDateKey_(todayFormatted, jst.yyyy);
  const allLogs = readAllLogRows_(logSheet);

  return buildTodayState_(allLogs, todayFormatted, todayKey, jst.yyyy);
}

function findSummaryRowIndex_(summaryRows, dateKey, fallbackYear, color, product) {
  for (let i = 0; i < summaryRows.length; i += 1) {
    const row = summaryRows[i];
    if (
      String(row[0] || '').trim() === PROCESS_NAME &&
      normalizeDateKey_(row[1], fallbackYear) === dateKey &&
      String(row[2] || '').trim() === color &&
      String(row[3] || '').trim() === product
    ) {
      return i;
    }
  }
  return -1;
}

function recordCompletion_(ss, payload, now) {
  const logSheet = getOrCreateSheet_(ss, SHEET_LOG, LOG_HEADERS);
  ensureLogHeader_(logSheet);
  const summarySheet = getOrCreateSheet_(ss, SHEET_SUMMARY, SUMMARY_HEADERS);

  const summaryRows = readSummaryRows_(summarySheet);
  const datePattern = extractDatePatternFromSummaryRows_(summaryRows);
  const jst = getJstParts_(now);
  const dateString = formatDateWithPattern_(now, datePattern);
  const todayKey = normalizeDateKey_(dateString, jst.yyyy);

  const allLogs = readAllLogRows_(logSheet);
  const existingIds = allLogs.map(function (r) {
    return r.id;
  });
  const id = generateRecordId_(now, existingIds);

  const durationSec = Math.max(0, Math.round(Number(payload.durationSec) || 0));
  const startTime = payload.startTime || formatTimeHms_(now);
  const endTime = payload.endTime || formatTimeHms_(now);
  const isThrough = Boolean(payload.isThrough);
  const judgement = isThrough ? JUDGE_THROUGH : JUDGE_NORMAL;

  logSheet.appendRow([
    id,
    dateString,
    startTime,
    endTime,
    durationSec,
    payload.color,
    payload.product,
    judgement,
    '',
  ]);

  const matchIndex = findSummaryRowIndex_(
    summaryRows,
    todayKey,
    jst.yyyy,
    payload.color,
    payload.product
  );

  if (matchIndex !== -1) {
    const existingRow = summaryRows[matchIndex];
    const newQty = (Number(existingRow[4]) || 0) + 1;
    const newThrough = (Number(existingRow[5]) || 0) + (isThrough ? 1 : 0);
    summarySheet.getRange(matchIndex + 1, 5, 1, 2).setValues([[newQty, newThrough]]);
  } else {
    if (summarySheet.getLastRow() === 0) {
      summarySheet.getRange(1, 1, 1, SUMMARY_HEADERS.length).setValues([SUMMARY_HEADERS]);
    }
    summarySheet.appendRow([
      PROCESS_NAME,
      dateString,
      payload.color,
      payload.product,
      1,
      isThrough ? 1 : 0,
    ]);
  }

  const newRecord = {
    rowIndex: logSheet.getLastRow(),
    id: id,
    date: dateString,
    startTime: startTime,
    endTime: endTime,
    durationSec: durationSec,
    color: payload.color,
    product: payload.product,
    judgement: judgement,
    memo: '',
  };
  const state = buildTodayState_(allLogs.concat([newRecord]), dateString, todayKey, jst.yyyy);

  return Object.assign({ created: newRecord }, state);
}

function addManualRecord_(ss, payload, now) {
  const logSheet = getOrCreateSheet_(ss, SHEET_LOG, LOG_HEADERS);
  ensureLogHeader_(logSheet);
  const summarySheet = getOrCreateSheet_(ss, SHEET_SUMMARY, SUMMARY_HEADERS);

  const summaryRows = readSummaryRows_(summarySheet);
  const datePattern = extractDatePatternFromSummaryRows_(summaryRows);
  const jst = getJstParts_(now);
  const dateString = formatDateWithPattern_(now, datePattern);
  const todayKey = normalizeDateKey_(dateString, jst.yyyy);

  const allLogs = readAllLogRows_(logSheet);
  const id = generateRecordId_(
    now,
    allLogs.map(function (r) {
      return r.id;
    })
  );

  const durationSec = Math.max(0, Math.round(Number(payload.durationSec) || 0));
  const endTime = payload.endTime || formatTimeHms_(now);
  const startTime =
    payload.startTime ||
    formatTimeHms_(new Date(now.getTime() - durationSec * 1000));
  const isThrough = Boolean(payload.isThrough);
  const judgement = isThrough ? JUDGE_THROUGH : JUDGE_NORMAL;
  const memo = String(payload.memo || '').trim() || '手動追加';

  logSheet.appendRow([
    id,
    dateString,
    startTime,
    endTime,
    durationSec,
    payload.color,
    payload.product,
    judgement,
    memo,
  ]);

  syncSummaryForPairs_(ss, todayKey, dateString, jst.yyyy, [
    { color: payload.color, product: payload.product },
  ]);

  return getTodayState_(ss, now);
}

function updateRecord_(ss, id, payload, now) {
  const logSheet = getOrCreateSheet_(ss, SHEET_LOG, LOG_HEADERS);
  const allLogs = readAllLogRows_(logSheet);
  let target = null;
  for (let i = 0; i < allLogs.length; i += 1) {
    if (allLogs[i].id === id) {
      target = allLogs[i];
      break;
    }
  }
  if (!target) {
    throw new Error('対象の記録が見つかりません (ID: ' + id + ')');
  }

  const jst = getJstParts_(now);
  const targetDateKey = normalizeDateKey_(target.date, jst.yyyy);
  const durationSec = Math.max(0, Math.round(Number(payload.durationSec) || 0));
  const isThrough = Boolean(payload.isThrough);
  const judgement = isThrough ? JUDGE_THROUGH : JUDGE_NORMAL;
  const rawMemo = String(payload.memo || '').trim();
  const memo = rawMemo ? '修正: ' + rawMemo : '修正';

  logSheet
    .getRange(target.rowIndex, 1, 1, 9)
    .setValues([
      [
        target.id,
        target.date,
        target.startTime,
        target.endTime,
        durationSec,
        payload.color,
        payload.product,
        judgement,
        memo,
      ],
    ]);

  const pairs = [{ color: payload.color, product: payload.product }];
  if (target.color !== payload.color || target.product !== payload.product) {
    pairs.push({ color: target.color, product: target.product });
  }

  syncSummaryForPairs_(ss, targetDateKey, target.date, jst.yyyy, pairs);
  return getTodayState_(ss, now);
}

function deleteRecord_(ss, id, payload, now) {
  const logSheet = getOrCreateSheet_(ss, SHEET_LOG, LOG_HEADERS);
  const allLogs = readAllLogRows_(logSheet);
  let target = null;
  for (let i = 0; i < allLogs.length; i += 1) {
    if (allLogs[i].id === id) {
      target = allLogs[i];
      break;
    }
  }
  if (!target) {
    throw new Error('対象の記録が見つかりません (ID: ' + id + ')');
  }

  const jst = getJstParts_(now);
  const targetDateKey = normalizeDateKey_(target.date, jst.yyyy);
  const rawMemo = String((payload && payload.memo) || '').trim();
  const memo = rawMemo ? DELETE_MARKER + ' ' + rawMemo : DELETE_MARKER;

  logSheet.getRange(target.rowIndex, 9, 1, 1).setValues([[memo]]);

  syncSummaryForPairs_(ss, targetDateKey, target.date, jst.yyyy, [
    { color: target.color, product: target.product },
  ]);

  return getTodayState_(ss, now);
}

function syncSummaryForPairs_(ss, dateKey, dateString, fallbackYear, pairs) {
  const logSheet = getOrCreateSheet_(ss, SHEET_LOG, LOG_HEADERS);
  const summarySheet = getOrCreateSheet_(ss, SHEET_SUMMARY, SUMMARY_HEADERS);
  const allLogs = readAllLogRows_(logSheet);

  const aggregated = {};
  for (let i = 0; i < allLogs.length; i += 1) {
    const rec = allLogs[i];
    if (normalizeDateKey_(rec.date, fallbackYear) !== dateKey) continue;
    if (isRowDeleted_(rec.memo)) continue;
    const key = rec.color + '__' + rec.product;
    if (!aggregated[key]) {
      aggregated[key] = { quantity: 0, throughCount: 0 };
    }
    aggregated[key].quantity += 1;
    if (rec.judgement === JUDGE_THROUGH) {
      aggregated[key].throughCount += 1;
    }
  }

  const summaryRows = readSummaryRows_(summarySheet);
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    const agg = aggregated[pair.color + '__' + pair.product] || {
      quantity: 0,
      throughCount: 0,
    };
    const matchIndex = findSummaryRowIndex_(
      summaryRows,
      dateKey,
      fallbackYear,
      pair.color,
      pair.product
    );

    if (matchIndex !== -1) {
      summarySheet
        .getRange(matchIndex + 1, 5, 1, 2)
        .setValues([[agg.quantity, agg.throughCount]]);
      summaryRows[matchIndex][4] = agg.quantity;
      summaryRows[matchIndex][5] = agg.throughCount;
    } else if (agg.quantity > 0) {
      if (summarySheet.getLastRow() === 0) {
        summarySheet.getRange(1, 1, 1, SUMMARY_HEADERS.length).setValues([SUMMARY_HEADERS]);
        summaryRows.push(SUMMARY_HEADERS);
      }
      const newRow = [
        PROCESS_NAME,
        dateString,
        pair.color,
        pair.product,
        agg.quantity,
        agg.throughCount,
      ];
      summarySheet.appendRow(newRow);
      summaryRows.push(newRow);
    }
  }
}
