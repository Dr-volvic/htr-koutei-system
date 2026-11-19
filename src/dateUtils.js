const JST_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Extract JST date/time components from a Date or timestamp.
 */
export function getJstParts(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const parts = JST_PARTS_FORMATTER.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    yyyy: map.year,
    yy: map.year.slice(-2),
    mm: map.month,
    dd: map.day,
    m: String(Number(map.month)),
    d: String(Number(map.day)),
    hh: hour,
    min: map.minute,
    ss: map.second,
  };
}

/**
 * Format HH:mm:ss in JST.
 */
export function formatTimeHms(dateInput = new Date()) {
  const p = getJstParts(dateInput);
  return `${p.hh}:${p.min}:${p.ss}`;
}

/**
 * Detect the date format used in an existing spreadsheet cell (e.g. last row of 700Bデータ Col B).
 * Returns a descriptor object used by formatDateWithPattern and normalizeDateKey.
 */
export function detectDatePattern(sample) {
  const raw = String(sample ?? '').trim();
  if (!raw) {
    return { type: 'ymd', sep: '/', padMonth: true, padDay: true, yearDigits: 4 };
  }

  // e.g. 2026年11月19日 or 2026年1月5日
  let m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    return {
      type: 'jp',
      padMonth: m[2].length === 2 && m[2].startsWith('0'),
      padDay: m[3].length === 2 && m[3].startsWith('0'),
      yearDigits: 4,
    };
  }

  // e.g. 2026/11/19, 2026/1/5, 2026-11-19, 26/11/19
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

  // e.g. 11/19 or 1/5 or 11-19
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

/**
 * Format a Date into the detected spreadsheet date pattern (in JST).
 */
export function formatDateWithPattern(dateInput, pattern) {
  const p = getJstParts(dateInput);
  const pat = pattern || { type: 'ymd', sep: '/', padMonth: true, padDay: true, yearDigits: 4 };
  const mStr = pat.padMonth ? p.mm : p.m;
  const dStr = pat.padDay ? p.dd : p.d;

  if (pat.type === 'jp') {
    return `${p.yyyy}年${mStr}月${dStr}日`;
  }
  if (pat.type === 'md') {
    return `${mStr}${pat.sep}${dStr}`;
  }
  const yStr = pat.yearDigits === 2 ? p.yy : p.yyyy;
  return `${yStr}${pat.sep}${mStr}${pat.sep}${dStr}`;
}

/**
 * Normalize a spreadsheet date string into a comparable calendar key (YYYY-MM-DD or MM-DD).
 * Used to match "today" reliably even if zero-padding differs.
 */
export function normalizeDateKey(rawValue, fallbackYear) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return '';

  let m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  m = raw.match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const year = m[1].length === 2 ? `20${m[1]}` : m[1];
    return `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  m = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const y = fallbackYear || getJstParts(new Date()).yyyy;
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  return raw;
}

/**
 * Generate a unique datetime-based ID: YYYYMMDD-HHmmss-NNN
 */
export function generateRecordId(dateInput = new Date(), existingIds = []) {
  const p = getJstParts(dateInput);
  const prefix = `${p.yyyy}${p.mm}${p.dd}-${p.hh}${p.min}${p.ss}`;
  const existingSet = new Set(existingIds);
  let seq = 1;
  while (existingSet.has(`${prefix}-${String(seq).padStart(3, '0')}`)) {
    seq += 1;
  }
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}
