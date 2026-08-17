// ============================================================
// AI 选题雷达 —— 端到端验收测试
// 验收标准：
//  1. 信息可以正常获取（真实采集 ≥20 条，五类均有数据）
//  2. 五个分类正常切换（每类均有条目、分类字段合法）
//  3. 原始链接可以打开（抽样 HEAD 检查，通过率 ≥60%）
//  4. 报告可以下载（HTML / Markdown 端点返回完整内容）
//  5. 桌面与手机页面正常（首页含 viewport、响应式样式、核心脚本）
// 运行：node test/e2e.mjs
// ============================================================

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const CACHE_FILE = path.join(ROOT, 'data', 'test-cache.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AI-TopicRadar-Test';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ❌ ${msg}`); };
const ok = (msg) => console.log(`  ✅ ${msg}`);

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, ...opts });
  return { status: res.status, body: await res.json().catch(() => null), text: await res.text().catch(() => '') };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return { status: res.status, text: await res.text() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, intervalMs = 3000, desc = '') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${desc}`);
    await sleep(intervalMs);
  }
}

async function headLink(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    return { url, status: res.status };
  } catch (e) {
    return { url, status: 0, err: String(e.message || e).slice(0, 60) };
  } finally {
    clearTimeout(t);
  }
}

async function runPool(tasks, n = 10) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; results[k] = await tasks[k](); }
  });
  await Promise.all(workers);
  return results;
}

// ---------- 启动服务 ----------

console.log('▶ 启动服务（端口 ' + PORT + '）…');
const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), REFRESH_MIN: '120', CACHE_FILE },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

try {
  await waitFor(async () => {
    try {
      const r = await fetchJson(`${BASE}/api/health`);
      return r.status === 200 && r.body?.ok ? r.body : null;
    } catch { return null; }
  }, 20000, 1000, '服务启动');

  console.log('\n▶ 触发真实采集（全部信源）…');
  const trig = await fetchJson(`${BASE}/api/refresh`, { method: 'POST' });
  if (trig.status !== 200) fail('POST /api/refresh 返回 ' + trig.status);
  else ok('POST /api/refresh 触发成功');

  const stats = await waitFor(async () => {
    const r = await fetchJson(`${BASE}/api/items`);
    if (r.status !== 200 || !r.body) return null;
    return r.body.refreshing === false && r.body.lastRefresh ? r.body : null;
  }, 300000, 5000, '首次采集完成（最长 5 分钟）');

  // ---------- 验收 1：信息可以正常获取 ----------
  console.log('\n▶ 验收 1：信息可以正常获取');
  const total = stats.total;
  console.log(`  共采集 ${total} 条，信源 ${stats.sourcesOk}/${stats.sourcesTotal} 正常`);
  if (total < 20) fail(`总条数仅 ${total}，应 ≥ 20`);
  else ok(`总条数 ${total} ≥ 20`);

  const ORDER = ['exposure', 'discussion', 'frontier', 'practical', 'jobs'];
  for (const k of ORDER) {
    const n = stats.byCategory[k];
    console.log(`  ${stats.categories[k].emoji} ${stats.categories[k].label}: ${n} 条`);
    if (n < 1) fail(`分类「${stats.categories[k].label}」无数据`);
    else ok(`分类「${stats.categories[k].label}」有 ${n} 条`);
  }

  // ---------- 验收 2：条目字段完整（分类切换依赖） ----------
  console.log('\n▶ 验收 2：条目字段完整性');
  let bad = 0;
  for (const it of stats.items) {
    if (!it.title || !it.url || !/^https?:\/\//.test(it.url) || !it.author || !it.source || !ORDER.includes(it.category)) {
      bad++;
      if (bad <= 3) console.log(`  异常条目: ${JSON.stringify({ title: it.title, url: it.url, author: it.author, source: it.source, category: it.category })}`);
    }
  }
  if (bad) fail(`${bad} 个条目字段不完整`);
  else ok(`全部 ${total} 个条目均含标题/链接/发布者/来源/分类`);

  // ---------- 验收 3：原始链接可以打开 ----------
  console.log('\n▶ 验收 3：原始链接可打开性（抽样 HEAD 检查）…');
  const sample = [...new Map(stats.items.map((it) => [it.url, it])).values()].slice(0, 60);
  const linkResults = await runPool(sample.map((it) => () => headLink(it.url)));
  let okLinks = 0, softFail = 0;
  const broken = [];
  for (const r of linkResults) {
    if (r.status >= 200 && r.status < 400) okLinks++;
    else if (r.status === 403 || r.status === 405) softFail++; // 反爬/不支持 HEAD，链接本身通常可打开
    else broken.push(r);
  }
  const rate = (okLinks + softFail) / linkResults.length;
  console.log(`  检查 ${linkResults.length} 条链接：可打开 ${okLinks}，疑似可打开 ${softFail}，失败 ${broken.length}（通过率 ${(rate * 100).toFixed(0)}%）`);
  for (const b of broken.slice(0, 10)) console.log(`    ⚠️ ${b.status || b.err} ${b.url}`);
  if (rate < 0.6) fail(`链接通过率 ${(rate * 100).toFixed(0)}% < 60%`);
  else ok(`链接通过率 ${(rate * 100).toFixed(0)}% ≥ 60%`);

  // ---------- 验收 4：报告可以下载 ----------
  console.log('\n▶ 验收 4：报告可以下载');
  const html = await fetchText(`${BASE}/api/report.html`);
  if (html.status !== 200 || html.text.length < 10000 || !html.text.includes('</html>')) {
    fail(`HTML 报告异常（状态 ${html.status}，长度 ${html.text.length}）`);
  } else ok(`HTML 报告正常（${(html.text.length / 1024).toFixed(0)} KB）`);

  const md = await fetchText(`${BASE}/api/report.md`);
  if (md.status !== 200 || md.text.length < 2000) fail(`MD 报告异常（状态 ${md.status}，长度 ${md.text.length}）`);
  else ok(`Markdown 报告正常（${(md.text.length / 1024).toFixed(0)} KB）`);

  // ---------- 验收 5：桌面 / 手机页面 ----------
  console.log('\n▶ 验收 5：桌面与手机页面');
  const page = await fetchText(`${BASE}/`);
  if (page.status !== 200) fail('首页无法访问');
  else {
    ok('首页可访问');
    if (!page.text.includes('name="viewport"')) fail('缺少 viewport（手机适配前提）');
    else ok('viewport 已配置（手机可正常显示）');
    if (!page.text.includes('选题雷达')) fail('首页缺少品牌标题');
    else ok('首页渲染内容正常');
    const css = await fetchText(`${BASE}/style.css`);
    if (css.status !== 200 || !css.text.includes('@media (max-width: 640px)')) fail('缺少手机端响应式样式');
    else ok('响应式断点样式存在（手机布局可用）');
    const js = await fetchText(`${BASE}/app.js`);
    if (js.status !== 200 || js.text.length < 5000) fail('前端脚本异常');
    else ok('前端脚本正常加载');
  }

  // ---------- 信源状态汇总 ----------
  console.log('\n▶ 信源状态汇总：');
  for (const s of stats.sources) {
    const mark = s.ok === true ? '✅' : s.ok === false ? '❌' : '⏳';
    console.log(`  ${mark} ${s.name}${s.count ? `（${s.count} 条 / ${s.ms}ms）` : ''}${s.error ? ` — ${s.error}` : ''}`);
  }
} catch (e) {
  fail('测试执行失败：' + e.message);
  console.log('\n--- 服务日志尾部 ---\n' + serverLog.slice(-3000));
} finally {
  server.kill();
}

console.log('\n' + (failures ? `❌ 测试未通过（${failures} 项失败）` : '🎉 全部验收标准通过！'));
process.exit(failures ? 1 : 0);
