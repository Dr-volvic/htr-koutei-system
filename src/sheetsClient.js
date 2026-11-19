import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import {
  DELETE_MARKER,
  JUDGE_NORMAL,
  JUDGE_THROUGH,
  LOG_HEADERS,
  PROCESS_NAME,
  SHEET_LOG,
  SHEET_SUMMARY,
  SUMMARY_HEADERS,
} from './config.js';
import {
  detectDatePattern,
  formatDateWithPattern,
  formatTimeHms,
  generateRecordId,
  getJstParts,
  normalizeDateKey,
} from './dateUtils.js';
import {
  aggregateForSummary,
  computeDashboardStats,
  isRowDeleted,
} from './statsUtils.js';

/**
 * Create an authenticated Google Sheets v4 API client from config.
 */
export async function createGoogleSheetsApi(config) {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  let authOptions;

  if (config.serviceAccountJson) {
    const credentials = JSON.parse(config.serviceAccountJson);
    authOptions = { credentials, scopes };
  } else if (config.keyPath) {
    const resolvedPath = path.resolve(config.keyPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `サービスアカウント鍵ファイルが見つかりません (GOOGLE_APPLICATION_CREDENTIALS): ${resolvedPath}`
      );
    }
    authOptions = { keyFile: resolvedPath, scopes };
  } else {
    const fallbackPath = path.resolve('./service-account.json');
    if (fs.existsSync(fallbackPath)) {
      authOptions = { keyFile: fallbackPath, scopes };
    } else {
      throw new Error(
        '環境変数 GOOGLE_APPLICATION_CREDENTIALS が設定されていません。'
      );
    }
  }

  const auth = new google.auth.GoogleAuth(authOptions);
  return google.sheets({ version: 'v4', auth });
}

function parseLogRow(row, rowIndex) {
  return {
    rowIndex,
    id: String(row[0] ?? '').trim(),
    date: String(row[1] ?? '').trim(),
    startTime: String(row[2] ?? '').trim(),
    endTime: String(row[3] ?? '').trim(),
    durationSec: Number(row[4] ?? 0) || 0,
    color: String(row[5] ?? '').trim(),
    product: String(row[6] ?? '').trim(),
    judgement: String(row[7] ?? '').trim() || JUDGE_NORMAL,
    memo: String(row[8] ?? '').trim(),
  };
}

export class SheetsService {
  constructor({ sheetsApi, spreadsheetId }) {
    this.sheetsApi = sheetsApi;
    this.spreadsheetId = spreadsheetId;
    this._lock = Promise.resolve();
    this._logHeaderEnsured = false;
  }

  _withLock(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.catch(() => {});
    return run;
  }

  async _getValues(range) {
    const res = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    return res.data.values || [];
  }

  async _updateValues(range, values) {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async _appendValues(range, values) {
    await this.sheetsApi.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }

  async ensureLogHeader() {
    if (this._logHeaderEnsured) return;
    const rows = await this._getValues(`${SHEET_LOG}!A1:I1`);
    const firstRow = rows[0] || [];
    const isEmpty =
      firstRow.length === 0 || firstRow.every((cell) => String(cell ?? '').trim() === '');
    if (isEmpty) {
      await this._updateValues(`${SHEET_LOG}!A1:I1`, [LOG_HEADERS]);
    }
    this._logHeaderEnsured = true;
  }

  _extractDatePattern(summaryRows) {
    let lastDateSample = '';
    for (let i = summaryRows.length - 1; i >= 0; i -= 1) {
      const colB = String(summaryRows[i]?.[1] ?? '').trim();
      if (colB && colB !== '日付' && /\d/.test(colB)) {
        lastDateSample = colB;
        break;
      }
    }
    return detectDatePattern(lastDateSample);
  }

  _parseLogRows(rows) {
    const parsed = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      if (i === 0 && String(row[0] ?? '').trim() === 'ID') continue;
      if (!String(row[0] ?? '').trim()) continue;
      parsed.push(parseLogRow(row, i + 1));
    }
    return parsed;
  }

  async _batchGetLogAndSummary() {
    if (typeof this.sheetsApi.spreadsheets.values.batchGet === 'function') {
      const res = await this.sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId: this.spreadsheetId,
        ranges: [`${SHEET_LOG}!A:I`, `${SHEET_SUMMARY}!A:F`],
        valueRenderOption: 'FORMATTED_VALUE',
      });
      const [logRes, summaryRes] = res.data.valueRanges || [];
      const logRows = logRes?.values || [];
      const summaryRows = summaryRes?.values || [];
      return {
        allLogs: this._parseLogRows(logRows),
        summaryRows,
        datePattern: this._extractDatePattern(summaryRows),
      };
    }

    const [logRows, summaryRows] = await Promise.all([
      this._getValues(`${SHEET_LOG}!A:I`),
      this._getValues(`${SHEET_SUMMARY}!A:F`),
    ]);
    return {
      allLogs: this._parseLogRows(logRows),
      summaryRows,
      datePattern: this._extractDatePattern(summaryRows),
    };
  }

  async _readSummaryAndDatePattern() {
    const rows = await this._getValues(`${SHEET_SUMMARY}!A:F`);
    return { summaryRows: rows, datePattern: this._extractDatePattern(rows) };
  }

  async _readAllLogRows() {
    const rows = await this._getValues(`${SHEET_LOG}!A:I`);
    return this._parseLogRows(rows);
  }

  _buildTodayState(allLogs, dateFormatted, todayKey, fallbackYear) {
    const todayAll = allLogs.filter(
      (r) => normalizeDateKey(r.date, fallbackYear) === todayKey
    );
    const activeToday = todayAll.filter((r) => !isRowDeleted(r.memo));
    const stats = computeDashboardStats(activeToday);
    return {
      dateString: dateFormatted,
      todayKey,
      records: [...activeToday].reverse(),
      stats,
    };
  }

  async getTodayState(now = new Date()) {
    await this.ensureLogHeader();
    const { allLogs, datePattern } = await this._batchGetLogAndSummary();
    const jst = getJstParts(now);
    const todayFormatted = formatDateWithPattern(now, datePattern);
    const todayKey = normalizeDateKey(todayFormatted, jst.yyyy);
    return this._buildTodayState(allLogs, todayFormatted, todayKey, jst.yyyy);
  }

  async recordCompletion(payload, now = new Date()) {
    return this._withLock(async () => {
      await this.ensureLogHeader();
      const { allLogs, summaryRows, datePattern } =
        await this._batchGetLogAndSummary();
      const jst = getJstParts(now);
      const dateString = formatDateWithPattern(now, datePattern);
      const todayKey = normalizeDateKey(dateString, jst.yyyy);

      const existingIds = allLogs.map((r) => r.id);
      const id = generateRecordId(now, existingIds);

      const durationSec = Math.max(0, Math.round(Number(payload.durationSec) || 0));
      const startTime = payload.startTime || formatTimeHms(now);
      const endTime = payload.endTime || formatTimeHms(now);
      const judgement = payload.isThrough ? JUDGE_THROUGH : JUDGE_NORMAL;

      const appendLogPromise = this._appendValues(`${SHEET_LOG}!A:I`, [
        [
          id,
          dateString,
          startTime,
          endTime,
          durationSec,
          payload.color,
          payload.product,
          judgement,
          '',
        ],
      ]);

      // Update 700Bデータ in real time
      const matchIndex = this._findSummaryRowIndex(
        summaryRows,
        todayKey,
        jst.yyyy,
        payload.color,
        payload.product
      );

      let summaryPromise;
      if (matchIndex !== -1) {
        const existingRow = summaryRows[matchIndex];
        const newQty = (Number(existingRow[4]) || 0) + 1;
        const newThrough =
          (Number(existingRow[5]) || 0) + (payload.isThrough ? 1 : 0);
        const rowNumber = matchIndex + 1;
        summaryPromise = this._updateValues(
          `${SHEET_SUMMARY}!E${rowNumber}:F${rowNumber}`,
          [[newQty, newThrough]]
        );
      } else {
        summaryPromise = (async () => {
          if (summaryRows.length === 0) {
            await this._updateValues(`${SHEET_SUMMARY}!A1:F1`, [SUMMARY_HEADERS]);
          }
          await this._appendValues(`${SHEET_SUMMARY}!A:F`, [
            [
              PROCESS_NAME,
              dateString,
              payload.color,
              payload.product,
              1,
              payload.isThrough ? 1 : 0,
            ],
          ]);
        })();
      }

      await Promise.all([appendLogPromise, summaryPromise]);

      const newRecord = {
        rowIndex: allLogs.length + 2,
        id,
        date: dateString,
        startTime,
        endTime,
        durationSec,
        color: payload.color,
        product: payload.product,
        judgement,
        memo: '',
      };
      const updatedLogs = [...allLogs, newRecord];
      const state = this._buildTodayState(
        updatedLogs,
        dateString,
        todayKey,
        jst.yyyy
      );

      return {
        id,
        dateString,
        startTime,
        endTime,
        durationSec,
        judgement,
        state,
      };
    });
  }

  async addManualRecord(payload, now = new Date()) {
    return this._withLock(async () => {
      await this.ensureLogHeader();
      const { datePattern } = await this._readSummaryAndDatePattern();
      const jst = getJstParts(now);
      const dateString = formatDateWithPattern(now, datePattern);
      const todayKey = normalizeDateKey(dateString, jst.yyyy);

      const allLogs = await this._readAllLogRows();
      const id = generateRecordId(
        now,
        allLogs.map((r) => r.id)
      );

      const durationSec = Math.max(0, Math.round(Number(payload.durationSec) || 0));
      const endTime = payload.endTime || formatTimeHms(now);
      const startTime =
        payload.startTime ||
        formatTimeHms(new Date(now.getTime() - durationSec * 1000));
      const judgement = payload.isThrough ? JUDGE_THROUGH : JUDGE_NORMAL;
      const memo = String(payload.memo ?? '').trim() || '手動追加';

      await this._appendValues(`${SHEET_LOG}!A:I`, [
        [
          id,
          dateString,
          startTime,
          endTime,
          durationSec,
          payload.color,
          payload.product,
          judgement,
          memo,
        ],
      ]);

      await this._syncSummaryForPairs(
        todayKey,
        dateString,
        jst.yyyy,
        [{ color: payload.color, product: payload.product }]
      );

      return { id, dateString, startTime, endTime, durationSec, judgement, memo };
    });
  }

  async updateRecord(id, payload, now = new Date()) {
    return this._withLock(async () => {
      const allLogs = await this._readAllLogRows();
      const target = allLogs.find((r) => r.id === id);
      if (!target) {
        throw new Error(`対象の記録が見つかりません (ID: ${id})`);
      }

      const jst = getJstParts(now);
      const targetDateKey = normalizeDateKey(target.date, jst.yyyy);
      const durationSec = Math.max(0, Math.round(Number(payload.durationSec) || 0));
      const judgement = payload.isThrough ? JUDGE_THROUGH : JUDGE_NORMAL;
      const rawMemo = String(payload.memo ?? '').trim();
      const memo = rawMemo ? `修正: ${rawMemo}` : '修正';

      const updatedRow = [
        target.id,
        target.date,
        target.startTime,
        target.endTime,
        durationSec,
        payload.color,
        payload.product,
        judgement,
        memo,
      ];

      await this._updateValues(
        `${SHEET_LOG}!A${target.rowIndex}:I${target.rowIndex}`,
        [updatedRow]
      );

      const pairs = [{ color: payload.color, product: payload.product }];
      if (target.color !== payload.color || target.product !== payload.product) {
        pairs.push({ color: target.color, product: target.product });
      }

      await this._syncSummaryForPairs(targetDateKey, target.date, jst.yyyy, pairs);
      return { id: target.id };
    });
  }

  async deleteRecord(id, payload = {}, now = new Date()) {
    return this._withLock(async () => {
      const allLogs = await this._readAllLogRows();
      const target = allLogs.find((r) => r.id === id);
      if (!target) {
        throw new Error(`対象の記録が見つかりません (ID: ${id})`);
      }

      const jst = getJstParts(now);
      const targetDateKey = normalizeDateKey(target.date, jst.yyyy);
      const rawMemo = String(payload.memo ?? '').trim();
      const memo = rawMemo ? `${DELETE_MARKER} ${rawMemo}` : DELETE_MARKER;

      await this._updateValues(`${SHEET_LOG}!I${target.rowIndex}`, [[memo]]);

      await this._syncSummaryForPairs(targetDateKey, target.date, jst.yyyy, [
        { color: target.color, product: target.product },
      ]);

      return { id: target.id };
    });
  }

  _findSummaryRowIndex(summaryRows, dateKey, fallbackYear, color, product) {
    for (let i = 0; i < summaryRows.length; i += 1) {
      const row = summaryRows[i];
      if (!row || row.length < 4) continue;
      if (
        String(row[0] ?? '').trim() === PROCESS_NAME &&
        normalizeDateKey(row[1], fallbackYear) === dateKey &&
        String(row[2] ?? '').trim() === color &&
        String(row[3] ?? '').trim() === product
      ) {
        return i;
      }
    }
    return -1;
  }

  async _syncSummaryForPairs(dateKey, dateString, fallbackYear, pairs) {
    const allLogs = await this._readAllLogRows();
    const dateLogs = allLogs.filter(
      (r) => normalizeDateKey(r.date, fallbackYear) === dateKey
    );
    const aggregated = aggregateForSummary(dateLogs);
    const { summaryRows } = await this._readSummaryAndDatePattern();

    for (const { color, product } of pairs) {
      const agg = aggregated.get(`${color}__${product}`) || {
        quantity: 0,
        throughCount: 0,
      };
      const matchIndex = this._findSummaryRowIndex(
        summaryRows,
        dateKey,
        fallbackYear,
        color,
        product
      );

      if (matchIndex !== -1) {
        const rowNumber = matchIndex + 1;
        await this._updateValues(
          `${SHEET_SUMMARY}!E${rowNumber}:F${rowNumber}`,
          [[agg.quantity, agg.throughCount]]
        );
        summaryRows[matchIndex][4] = agg.quantity;
        summaryRows[matchIndex][5] = agg.throughCount;
      } else if (agg.quantity > 0) {
        if (summaryRows.length === 0) {
          await this._updateValues(`${SHEET_SUMMARY}!A1:F1`, [SUMMARY_HEADERS]);
          summaryRows.push(SUMMARY_HEADERS);
        }
        const newRow = [
          PROCESS_NAME,
          dateString,
          color,
          product,
          agg.quantity,
          agg.throughCount,
        ];
        await this._appendValues(`${SHEET_SUMMARY}!A:F`, [newRow]);
        summaryRows.push(newRow);
      }
    }
  }
}
