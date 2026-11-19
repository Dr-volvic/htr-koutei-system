import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { COLORS, PRODUCTS } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

function validateColorAndProduct(color, product) {
  if (!COLORS.includes(color)) {
    return `COLORが不正です (${color})`;
  }
  if (!PRODUCTS.includes(product)) {
    return `製品が不正です (${product})`;
  }
  return null;
}

export function createApp({ getSheetsService, configError = null }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  function requireService(res) {
    const svc = getSheetsService();
    if (!svc) {
      res.status(503).json({
        error:
          configError ||
          'Googleスプレッドシート接続が未設定です。SPREADSHEET_ID とサービスアカウント鍵を確認してください。',
      });
      return null;
    }
    return svc;
  }

  app.get('/api/health', (req, res) => {
    const svc = getSheetsService();
    res.json({
      ok: Boolean(svc),
      configured: Boolean(svc),
      error: svc ? null : configError,
    });
  });

  app.get('/api/today', async (req, res) => {
    const svc = requireService(res);
    if (!svc) return;
    try {
      const state = await svc.getTodayState();
      res.json(state);
    } catch (err) {
      res.status(500).json({
        error: `スプレッドシートの読み込みに失敗しました: ${err.message}`,
      });
    }
  });

  app.post('/api/records', async (req, res) => {
    const svc = requireService(res);
    if (!svc) return;
    const { color, product, startTime, endTime, durationSec, isThrough } =
      req.body || {};
    const validationError = validateColorAndProduct(color, product);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    try {
      const result = await svc.recordCompletion({
        color,
        product,
        startTime,
        endTime,
        durationSec: Math.max(0, Number(durationSec) || 0),
        isThrough: Boolean(isThrough),
      });
      const state = result.state || (await svc.getTodayState());
      const { state: _ignored, ...created } = result;
      res.status(201).json({ created, ...state });
    } catch (err) {
      res.status(500).json({
        error: `スプレッドシートへの記録に失敗しました: ${err.message}`,
      });
    }
  });

  app.post('/api/records/manual', async (req, res) => {
    const svc = requireService(res);
    if (!svc) return;
    const { color, product, startTime, endTime, durationSec, isThrough, memo } =
      req.body || {};
    const validationError = validateColorAndProduct(color, product);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    try {
      const created = await svc.addManualRecord({
        color,
        product,
        startTime,
        endTime,
        durationSec: Math.max(0, Number(durationSec) || 0),
        isThrough: Boolean(isThrough),
        memo,
      });
      const state = await svc.getTodayState();
      res.status(201).json({ created, ...state });
    } catch (err) {
      res.status(500).json({
        error: `手動追加に失敗しました: ${err.message}`,
      });
    }
  });

  app.patch('/api/records/:id', async (req, res) => {
    const svc = requireService(res);
    if (!svc) return;
    const { color, product, durationSec, isThrough, memo } = req.body || {};
    const validationError = validateColorAndProduct(color, product);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    try {
      await svc.updateRecord(req.params.id, {
        color,
        product,
        durationSec: Math.max(0, Number(durationSec) || 0),
        isThrough: Boolean(isThrough),
        memo,
      });
      const state = await svc.getTodayState();
      res.json(state);
    } catch (err) {
      res.status(500).json({
        error: `記録の修正に失敗しました: ${err.message}`,
      });
    }
  });

  app.delete('/api/records/:id', async (req, res) => {
    const svc = requireService(res);
    if (!svc) return;
    const { memo } = req.body || {};
    try {
      await svc.deleteRecord(req.params.id, { memo });
      const state = await svc.getTodayState();
      res.json(state);
    } catch (err) {
      res.status(500).json({
        error: `記録の削除に失敗しました: ${err.message}`,
      });
    }
  });

  return app;
}
