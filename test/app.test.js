import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApp } from '../src/app.js';

function invokeApp(app, { method = 'GET', url = '/', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.originalUrl = url;
    req.headers = { 'content-type': 'application/json' };
    req.body = body;
    req.socket = {};
    req.connection = {};

    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (k, v) => {
      res.headers[k.toLowerCase()] = v;
    };
    res.getHeader = (k) => res.headers[k.toLowerCase()];
    res.removeHeader = (k) => {
      delete res.headers[k.toLowerCase()];
    };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload) => {
      resolve({ status: res.statusCode, body: payload });
      return res;
    };
    res.send = (payload) => {
      resolve({ status: res.statusCode, body: payload });
      return res;
    };
    res.end = (chunk) => {
      if (chunk !== undefined) {
        resolve({ status: res.statusCode, body: chunk });
      }
      return res;
    };

    app.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, body: null });
    });

    // Trigger express.json() when body is pre-populated or empty
    process.nextTick(() => {
      if (body !== null) {
        req.emit('data', Buffer.from(JSON.stringify(body)));
      }
      req.emit('end');
    });
  });
}

test('Express API handles health, validation, and unconfigured state', async () => {
  const appUnconfigured = createApp({
    getSheetsService: () => null,
    configError: 'SPREADSHEET_ID missing',
  });

  const health = await invokeApp(appUnconfigured, { method: 'GET', url: '/api/health' });
  assert.equal(health.status, 200);
  assert.equal(health.body.configured, false);

  const today = await invokeApp(appUnconfigured, { method: 'GET', url: '/api/today' });
  assert.equal(today.status, 503);
});

test('Express API validates color and product on POST /api/records', async () => {
  const fakeService = {
    async getTodayState() {
      return { dateString: '2026/11/19', records: [], stats: {} };
    },
    async recordCompletion() {
      return { id: '20261119-153012-001' };
    },
  };
  const app = createApp({ getSheetsService: () => fakeService });

  const bad = await invokeApp(app, {
    method: 'POST',
    url: '/api/records',
    body: { color: 'INVALID', product: 'RH', durationSec: 10 },
  });
  assert.equal(bad.status, 400);

  const ok = await invokeApp(app, {
    method: 'POST',
    url: '/api/records',
    body: { color: '1F7', product: 'RH', durationSec: 10, isThrough: false },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.created.id, '20261119-153012-001');
});
