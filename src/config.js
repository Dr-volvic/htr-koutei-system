export const COLORS = ['1F7', '1G3', '4V8'];
export const PRODUCTS = ['RH', 'LH', 'No1', 'CTB'];
export const PROCESS_NAME = 'MIGAKI';

export const SHEET_LOG = '700B集計';
export const SHEET_SUMMARY = '700Bデータ';

export const LOG_HEADERS = [
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

export const SUMMARY_HEADERS = [
  '工程',
  '日付',
  'COLOR',
  '製品',
  '数量',
  'スルー数',
];

export const JUDGE_NORMAL = '通常';
export const JUDGE_THROUGH = 'スルー';
export const DELETE_MARKER = '[削除]';

export function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    spreadsheetId: process.env.SPREADSHEET_ID || '',
    keyPath:
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
      '',
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  };
}
