'use strict';
// ============================================================
// 选题报告生成器：HTML（可打印）与 Markdown 两种格式
// ============================================================

const { CATEGORIES, CATEGORY_ORDER } = require('./classify');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function reportFilename(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `AI选题雷达报告_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

function byCategory(items) {
  const groups = {};
  for (const k of CATEGORY_ORDER) groups[k] = [];
  for (const it of items) (groups[it.category] || groups.frontier).push(it);
  for (const k of CATEGORY_ORDER) {
    groups[k].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  }
  return groups;
}

// ---------- HTML 报告 ----------

function buildHtml(stats) {
  const groups = byCategory(stats.items);
  const secs = CATEGORY_ORDER.map((k) => {
    const cat = CATEGORIES[k];
    const rows = groups[k].map((it) => `
      <li class="item">
        <a class="t" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
        <div class="meta">✍️ ${esc(it.author)} &nbsp;·&nbsp; 📡 ${esc(it.source)} &nbsp;·&nbsp; 🕐 ${fmtTime(it.publishedAt)}${it.heatLabel ? ` &nbsp;·&nbsp; 🔥 ${esc(it.heatLabel)}` : ''}</div>
        ${it.summary ? `<p class="s">${esc(it.summary)}</p>` : ''}
        <div class="src"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a></div>
      </li>`).join('\n');
    return `
    <section>
      <h2><span class="chip" style="background:${cat.color}">${cat.emoji} ${cat.label}</span> <span class="cnt">${groups[k].length} 条 · ${cat.desc}</span></h2>
      <ul>${rows || '<li class="empty">本时段暂无</li>'}</ul>
    </section>`;
  }).join('\n');

  const srcRows = stats.sources.map((s) =>
    `<tr><td>${esc(s.name)}</td><td>${s.ok ? `✅ ${s.count} 条` : s.ok === false ? '❌ 采集失败' : '⏳ 未采集'}</td><td>${esc(s.error || '')}</td></tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 选题雷达报告</title>
<style>
  :root{--ink:#1a1d24;--muted:#6b7280;--line:#e5e7eb;--bg:#f6f7f9}
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);margin:0;background:var(--bg);line-height:1.6}
  .wrap{max-width:880px;margin:0 auto;padding:24px 16px 60px}
  header{border-bottom:2px solid var(--line);padding-bottom:16px;margin-bottom:24px}
  h1{font-size:26px;margin:0 0 6px}
  .sub{color:var(--muted);font-size:13px}
  .stats{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
  .stat{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:13px}
  section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:20px}
  h2{font-size:18px;margin:0 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .chip{color:#fff;padding:2px 10px;border-radius:999px;font-size:14px}
  .cnt{color:var(--muted);font-size:13px;font-weight:normal}
  ul{list-style:none;margin:0;padding:0}
  .item{padding:12px 0;border-top:1px solid var(--line)}
  .item:first-child{border-top:none}
  .t{font-size:15px;font-weight:600;color:#1d4ed8;text-decoration:none}
  .t:hover{text-decoration:underline}
  .meta{font-size:12.5px;color:var(--muted);margin-top:4px}
  .s{font-size:13px;color:#374151;margin:6px 0 0}
  .src{font-size:11.5px;color:#9ca3af;margin-top:4px;word-break:break-all}
  .src a{color:#9ca3af}
  .empty{color:var(--muted);font-size:13px;list-style:none}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td,th{border:1px solid var(--line);padding:6px 10px;text-align:left}
  th{background:#f3f4f6}
  footer{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
  @media print{body{background:#fff}section{break-inside:avoid;border:1px solid #ccc}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>📡 AI 选题雷达 · 72 小时全球 AI 情报报告</h1>
    <div class="sub">生成时间：${fmtTime(Date.now())} ｜ 数据窗口：最近 ${stats.windowHours} 小时 ｜ 信源：${stats.sourcesOk}/${stats.sourcesTotal} 个正常</div>
    <div class="stats">
      <span class="stat">总收录 <b>${stats.total}</b> 条</span>
      ${CATEGORY_ORDER.map((k) => `<span class="stat">${CATEGORIES[k].emoji} ${CATEGORIES[k].label} <b>${stats.byCategory[k]}</b></span>`).join('')}
    </div>
  </header>
  ${secs}
  <section>
    <h2>📡 信源状态</h2>
    <table><tr><th>信源</th><th>状态</th><th>说明</th></tr>${srcRows}</table>
  </section>
  <footer>本报告由 AI 选题雷达自动生成 · 数据来自公开信源 · 仅供参考，引用请核对原文</footer>
</div>
</body>
</html>`;
}

// ---------- Markdown 报告 ----------

function buildMd(stats) {
  const groups = byCategory(stats.items);
  const lines = [];
  lines.push(`# 📡 AI 选题雷达 · 72 小时全球 AI 情报报告`);
  lines.push('');
  lines.push(`> 生成时间：${fmtTime(Date.now())} ｜ 数据窗口：最近 ${stats.windowHours} 小时 ｜ 信源：${stats.sourcesOk}/${stats.sourcesTotal} 正常 ｜ 总收录 ${stats.total} 条`);
  lines.push('');
  lines.push(`| 分类 | 数量 |`);
  lines.push(`| --- | --- |`);
  for (const k of CATEGORY_ORDER) lines.push(`| ${CATEGORIES[k].emoji} ${CATEGORIES[k].label} | ${stats.byCategory[k]} |`);
  lines.push('');
  for (const k of CATEGORY_ORDER) {
    const cat = CATEGORIES[k];
    lines.push(`## ${cat.emoji} ${cat.label}（${groups[k].length} 条）`);
    lines.push('');
    lines.push(`> ${cat.desc}`);
    lines.push('');
    if (!groups[k].length) {
      lines.push('_本时段暂无_');
    } else {
      for (const it of groups[k]) {
        lines.push(`- **[${it.title.replace(/[\[\]]/g, '')}](${it.url})**`);
        lines.push(`  - ✍️ ${it.author} ｜ 📡 ${it.source} ｜ 🕐 ${fmtTime(it.publishedAt)}${it.heatLabel ? ` ｜ 🔥 ${it.heatLabel}` : ''}`);
        if (it.summary) lines.push(`  - ${it.summary.replace(/\n/g, ' ')}`);
      }
    }
    lines.push('');
  }
  lines.push('---');
  lines.push(`*本报告由 AI 选题雷达自动生成，数据来自公开信源，仅供参考。*`);
  return lines.join('\n');
}

module.exports = { buildHtml, buildMd, reportFilename };
