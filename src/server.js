import 'dotenv/config';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createGoogleSheetsApi, SheetsService } from './sheetsClient.js';

async function main() {
  const config = loadConfig();
  let sheetsService = null;
  let configError = null;

  if (!config.spreadsheetId) {
    configError = '環境変数 SPREADSHEET_ID が設定されていません。';
  } else {
    try {
      const sheetsApi = await createGoogleSheetsApi(config);
      sheetsService = new SheetsService({
        sheetsApi,
        spreadsheetId: config.spreadsheetId,
      });
    } catch (err) {
      configError = err.message;
    }
  }

  const app = createApp({
    getSheetsService: () => sheetsService,
    configError,
  });

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`700B ポリッシング作業記録アプリ起動: http://localhost:${config.port}`);
    if (configError) {
      console.warn(`⚠️ 設定警告: ${configError}`);
    } else {
      console.log(`✅ Googleスプレッドシート接続設定完了 (ID: ${config.spreadsheetId})`);
    }
  });
}

main();
