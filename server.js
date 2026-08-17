'use strict';
// ============================================================
// AI 选题雷达 —— HTTP 服务（API + 静态前端 + 报告下载）
// 监听 0.0.0.0，同一局域网内手机可直接访问
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const report = require('./lib/report');

const PORT = Number(process.env.PORT || 8787);
const REFRESH_MIN = Number(process.env.REFRESH_MIN || 30);
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { ...CORS, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const sendJson = (res, obj) => send(res, 200, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // ---------- API ----------
  if (p === '/api/health') return sendJson(res, { ok: true, uptime: Math.round(process.uptime()), refreshing: store.state.refreshing });
  if (p === '/api/items') return sendJson(res, store.stats());

  if (p === '/api/refresh') {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '请使用 POST 请求' });
    store.triggerRefresh();
    return sendJson(res, { ok: true, message: '采集已开始，请稍后刷新查看结果' });
  }

  if (p === '/api/report.html') {
    const html = report.buildHtml(store.stats());
    return send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.reportFilename('html'))}`,
    });
  }

  if (p === '/api/report.md') {
    const md = report.buildMd(store.stats());
    return send(res, 200, md, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.reportFilename('md'))}`,
    });
  }

  // ---------- 静态文件 ----------
  if (p === '/') p = '/index.html';
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC, safe);
  if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  }

  send(res, 404, 'Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================================');
  console.log('  📡 AI 选题雷达已启动');
  console.log(`  本机访问   http://localhost:${PORT}`);
  console.log(`  局域网访问 http://<本机IP>:${PORT}（手机可用）`);
  console.log(`  自动刷新   每 ${REFRESH_MIN} 分钟`);
  console.log('================================================');
  store.init(REFRESH_MIN);
});

process.on('uncaughtException', (e) => console.error('[fatal]', e));
process.on('unhandledRejection', (e) => console.error('[rejection]', e && e.message));
