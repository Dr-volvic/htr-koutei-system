import { COLORS, PRODUCTS, DELETE_MARKER, JUDGE_THROUGH } from './config.js';

/**
 * Check if a 700B集計 row is soft-deleted via Column I marker.
 */
export function isRowDeleted(memo) {
  return String(memo ?? '').trim().startsWith(DELETE_MARKER);
}

/**
 * Compute dashboard statistics from today's active 700B集計 records.
 * Through items ARE included in total time, total count, and color×product averages.
 */
export function computeDashboardStats(records) {
  const active = records.filter((r) => !isRowDeleted(r.memo));
  let totalSeconds = 0;
  let throughCount = 0;

  const matrix = {};
  for (const color of COLORS) {
    matrix[color] = {};
    for (const product of PRODUCTS) {
      matrix[color][product] = {
        count: 0,
        throughCount: 0,
        totalSeconds: 0,
        avgSeconds: null,
      };
    }
  }

  for (const rec of active) {
    const sec = Math.max(0, Number(rec.durationSec) || 0);
    const isThrough = rec.judgement === JUDGE_THROUGH;
    totalSeconds += sec;
    if (isThrough) throughCount += 1;

    if (matrix[rec.color]?.[rec.product]) {
      const cell = matrix[rec.color][rec.product];
      cell.count += 1;
      cell.totalSeconds += sec;
      if (isThrough) cell.throughCount += 1;
    }
  }

  for (const color of COLORS) {
    for (const product of PRODUCTS) {
      const cell = matrix[color][product];
      if (cell.count > 0) {
        cell.avgSeconds = Math.round(cell.totalSeconds / cell.count);
      }
    }
  }

  return {
    totalSeconds,
    totalCount: active.length,
    throughCount,
    normalCount: active.length - throughCount,
    matrix,
  };
}

/**
 * Aggregate today's active 700B集計 records by (color, product) for 700Bデータ sync.
 */
export function aggregateForSummary(records) {
  const counts = new Map();
  for (const rec of records) {
    if (isRowDeleted(rec.memo)) continue;
    const key = `${rec.color}__${rec.product}`;
    const entry = counts.get(key) || {
      color: rec.color,
      product: rec.product,
      quantity: 0,
      throughCount: 0,
    };
    entry.quantity += 1;
    if (rec.judgement === JUDGE_THROUGH) {
      entry.throughCount += 1;
    }
    counts.set(key, entry);
  }
  return counts;
}
