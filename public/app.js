'use strict';
/* ============================================================
   AI 选题雷达 —— 前端逻辑（零依赖原生 JS）
   ============================================================ */

const CATS = [
  { id: 'all', label: '全部' },
  { id: 'exposure', label: '曝光代理', emoji: '📰', color: '#e5484d' },
  { id: 'discussion', label: '公开讨论', emoji: '💬', color: '#3b82f6' },
  { id: 'frontier', label: '前沿变化', emoji: '🧪', color: '#8b5cf6' },
  { id: 'practical', label: '普通人落地', emoji: '🛠️', color: '#16a34a' },
  { id: 'jobs', label: '岗位与副业', emoji: '💼', color: '#d97706' },
];
const CAT_MAP = Object.fromEntries(CATS.map((c) => [c.id, c]));
const ORDER = ['exposure', 'discussion', 'frontier', 'practical', 'jobs'];

let DATA = null;          // /api/items 返回的完整数据
let active = 'all';
let query = '';
let sortMode = 'hot';
let pollTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 工具函数 ---------- */

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return d < 3 ? `${d} 天前` : `${new Date(ts).getMonth() + 1}月${new Date(ts).getDate()}日`;
}

function absTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sortHeat(it) {
  return it.category === 'exposure' ? (it.mentions || 0) : (it.heat || 0);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文（如局域网 IP 访问）降级方案
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- 数据加载 ---------- */

async function load() {
  try {
    const res = await fetch('/api/items', { cache: 'no-store' });
    const j = await res.json();
    DATA = j;
    render();
    if (j.refreshing || !j.lastRefresh) {
      schedulePoll(8000);
    } else if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  } catch (e) {
    $('emptyText').textContent = '无法连接数据服务，请确认服务器正在运行';
    $('empty').classList.remove('hidden');
    $('list').innerHTML = '';
    schedulePoll(8000);
  }
}

function schedulePoll(ms) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(load, ms);
}

async function manualRefresh() {
  const btn = $('refreshBtn');
  btn.disabled = true;
  btn.textContent = '🔄 采集中…';
  try {
    await fetch('/api/refresh', { method: 'POST' });
    toast('已开始重新采集全部信源，约需 30–90 秒');
    schedulePoll(5000);
  } catch (e) {
    toast('触发采集失败，请稍后再试');
    btn.disabled = false;
    btn.textContent = '🔄 立即刷新';
  }
}

/* ---------- 渲染 ---------- */

function visibleItems() {
  if (!DATA) return [];
  let items = DATA.items || [];
  if (active !== 'all') items = items.filter((it) => it.category === active);
  if (query) {
    const q = query.toLowerCase();
    items = items.filter((it) =>
      [it.title, it.author, it.source, it.summary].some((s) => String(s || '').toLowerCase().includes(q))
    );
  }
  items = [...items].sort((a, b) => {
    if (sortMode === 'new') return (b.publishedAt || 0) - (a.publishedAt || 0);
    const ah = sortHeat(a);
    const bh = sortHeat(b);
    if (ah !== bh) return bh - ah;
    return (b.publishedAt || 0) - (a.publishedAt || 0);
  });
  return items;
}

function render() {
  renderHeader();
  renderStats();
  renderTabs();
  renderList();
  renderSources();
}

function renderHeader() {
  const el = $('updateTime');
  const btn = $('refreshBtn');
  if (!DATA) {
    el.textContent = '正在连接…';
    return;
  }
  if (DATA.refreshing) {
    el.textContent = '🔄 正在采集全部信源…';
    btn.disabled = true;
    btn.textContent = '🔄 采集中…';
  } else {
    el.textContent = `🕐 更新于 ${DATA.lastRefresh ? absTime(DATA.lastRefresh) : '—'}（${DATA.windowHours}h 窗口）`;
    btn.disabled = false;
    btn.textContent = '🔄 立即刷新';
  }
  if (DATA.lastError) el.title = DATA.lastError;
}

function renderStats() {
  if (!DATA) return;
  const chips = [];
  const push = (catId, label, n) => {
    const cat = CAT_MAP[catId];
    chips.push(`<span class="stat-chip" data-cat="${catId}" title="${catId === 'all' ? '全部信息' : (cat.desc || '')}">
      <span class="dot" style="background:${catId === 'all' ? '#334155' : cat.color}"></span>${cat.emoji || '🗂️'} ${label} <b>${n}</b></span>`);
  };
  push('all', '总收录', DATA.total);
  for (const k of ORDER) {
    const cat = CAT_MAP[k];
    push(k, cat.label, DATA.byCategory[k] || 0);
  }
  $('statsBar').innerHTML = chips.join('');
}

function renderTabs() {
  if (!DATA) return;
  const tabs = CATS.map((c) => {
    const n = c.id === 'all' ? DATA.total : (DATA.byCategory[c.id] || 0);
    const color = c.id === 'all' ? '#334155' : c.color;
    return `<button class="tab${active === c.id ? ' active' : ''}" data-cat="${c.id}"
      style="${active === c.id ? `background:${color}` : ''}">${c.emoji || '🗂️'} ${c.label}<span class="cnt">${n}</span></button>`;
  }).join('');
  $('tabs').innerHTML = tabs;
}

function renderList() {
  const items = visibleItems();
  const list = $('list');
  const empty = $('empty');
  if (!items.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    $('emptyText').textContent = DATA && DATA.lastRefresh
      ? (query ? `没有找到与“${query}”相关的内容` : '该分类下暂无 72 小时内的信息')
      : '正在采集 72 小时全球 AI 情报，首次约需 30–90 秒…';
    $('empty').querySelector('.spinner').classList.toggle('hidden', !!(DATA && DATA.lastRefresh));
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = items.map((it) => {
    const cat = CAT_MAP[it.category] || CAT_MAP.frontier;
    const platforms = (it.coverage && it.coverage.length > 1)
      ? `<span class="time">📺 ${it.coverage.join(' / ')}</span>` : '';
    return `<article class="card" style="--c:${cat.color}">
      <div class="card-top">
        <span class="badge">${cat.emoji} ${cat.label}</span>
        <span class="time" title="${absTime(it.publishedAt)}">🕐 ${timeAgo(it.publishedAt)}</span>
        ${it.heatLabel ? `<span class="heat">🔥 ${esc(it.heatLabel)}</span>` : ''}
        ${platforms}
      </div>
      <h3 class="title"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      <div class="byline">✍️ ${esc(it.author)}<span class="sep">·</span>📡 ${esc(it.source)}</div>
      ${it.summary ? `<p class="summary">${esc(it.summary)}</p>` : ''}
      <div class="card-actions">
        <a class="btn-sm" href="${esc(it.url)}" target="_blank" rel="noopener">打开原文 ↗</a>
        <button class="btn-sm codez" data-i="${items.indexOf(it)}">发给 Codez 📋</button>
      </div>
    </article>`;
  }).join('');
}

function renderSources() {
  if (!DATA || !DATA.sources) return;
  $('srcOk').textContent = DATA.sourcesOk;
  $('srcTotal').textContent = DATA.sourcesTotal;
  const rows = DATA.sources.map((s) => {
    const state = s.ok === true ? `<span style="color:#16a34a">✅ ${s.count} 条</span>`
      : s.ok === false ? '<span style="color:#e5484d">❌ 失败</span>'
      : '<span style="color:#9ca3af">⏳ 待采集</span>';
    return `<tr><td>${esc(s.name)}</td><td>${state}</td><td>${s.count || ''}</td><td>${s.ms != null ? s.ms + 'ms' : ''}</td><td>${esc(s.error || '')}</td></tr>`;
  }).join('');
  $('srcTable').querySelector('tbody').innerHTML = rows;
}

/* ---------- 发给 Codez：生成选题指令 ---------- */

function buildPrompt(it) {
  const cat = CAT_MAP[it.category] || {};
  return [
    '【AI 选题任务】请基于以下线索，帮我整理一篇选题初稿：',
    `📌 标题：${it.title}`,
    `🗂 分类：${cat.emoji || ''} ${cat.label || ''}`,
    `📝 内容概括：${it.summary || it.title}`,
    `👤 发布者：${it.author}`,
    `📡 来源平台：${it.source}`,
    `🔥 热度：${it.heatLabel || '—'}`,
    `🕐 时间：${absTime(it.publishedAt)}`,
    `🔗 原文链接：${it.url}`,
    '',
    '请输出：3 个标题建议、核心观点、内容大纲（3-5 节）、适合的发布平台与切入角度。',
  ].join('\n');
}

async function sendToCodez(it) {
  const ok = await copyText(buildPrompt(it));
  toast(ok ? '✅ 选题指令已复制，粘贴到 Codez 即可生成初稿' : '复制失败，请手动复制');
}

/* ---------- 事件绑定 ---------- */

document.addEventListener('click', (e) => {
  const statChip = e.target.closest('.stat-chip');
  if (statChip) {
    active = statChip.dataset.cat;
    renderTabs();
    renderList();
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    active = tab.dataset.cat;
    renderTabs();
    renderList();
    return;
  }
  const codezBtn = e.target.closest('.codez');
  if (codezBtn) {
    const i = Number(codezBtn.dataset.i);
    const it = visibleItems()[i];
    if (it) sendToCodez(it);
  }
});

$('refreshBtn').addEventListener('click', manualRefresh);
$('search').addEventListener('input', (e) => { query = e.target.value.trim(); renderList(); });
$('sortSel').addEventListener('change', (e) => { sortMode = e.target.value; renderList(); });

/* ---------- 启动 ---------- */

load();
setInterval(() => { if (DATA && DATA.refreshing) load(); }, 15000);
