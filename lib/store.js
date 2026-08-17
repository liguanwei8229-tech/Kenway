'use strict';
// ============================================================
// 数据中心：定时采集 → 分类 → 去重 → 聚类 → 缓存落盘
// ============================================================

const fs = require('fs');
const path = require('path');
const { SOURCES, in72h, MAX_AGE_MS } = require('./fetchers');
const { CATEGORIES, CATEGORY_ORDER, classifyItem, dedupe, clusterExposure } = require('./classify');

const CACHE_FILE = process.env.CACHE_FILE || path.join(__dirname, '..', 'data', 'cache.json');

const state = {
  items: [],
  sourceStatus: {},
  lastRefresh: null,
  refreshing: false,
  lastError: null,
  startTime: Date.now(),
};

function emptyStatus() {
  const s = {};
  for (const src of SOURCES) s[src.id] = { id: src.id, name: src.name, ok: null, count: 0, ms: null, lastOk: null, error: null };
  return s;
}
state.sourceStatus = emptyStatus();

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (Array.isArray(j.items) && j.items.length) {
      state.items = j.items;
      state.lastRefresh = j.lastRefresh || null;
      state.sourceStatus = { ...emptyStatus(), ...(j.sourceStatus || {}) };
      console.log(`[store] 载入缓存 ${state.items.length} 条（上次采集 ${new Date(state.lastRefresh).toLocaleString()}）`);
      return true;
    }
  } catch (e) { /* 无缓存或损坏，忽略 */ }
  return false;
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      savedAt: Date.now(),
      lastRefresh: state.lastRefresh,
      items: state.items,
      sourceStatus: state.sourceStatus,
    }));
  } catch (e) {
    console.error('[store] 缓存写入失败:', e.message);
  }
}

// 并发池（限制同时请求的信源数量）
async function runPool(tasks, n = 8) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) {
      const k = i++;
      results[k] = await tasks[k].run();
    }
  });
  await Promise.all(workers);
  return results;
}

async function refresh() {
  if (state.refreshing) return false;
  state.refreshing = true;
  state.lastError = null;
  const t0 = Date.now();
  console.log('[store] 开始采集全部信源…');
  try {
    const results = await runPool(SOURCES.map((s) => ({
      run: async () => {
        const st0 = Date.now();
        try {
          const raw = (await s.fetch()) || [];
          const items = raw
            .filter((it) => it && it.title && in72h(it.publishedAt))
            .slice(0, 80)
            .map((it) => classifyItem(it, s));
          return { status: { id: s.id, name: s.name, ok: true, count: items.length, ms: Date.now() - st0, lastOk: Date.now(), error: null }, items };
        } catch (err) {
          return { status: { id: s.id, name: s.name, ok: false, count: 0, ms: Date.now() - st0, lastOk: null, error: String(err.message || err).slice(0, 150) }, items: [] };
        }
      },
    })));

    const status = {};
    let totalRaw = 0;
    const fresh = [];
    for (const r of results) {
      status[r.status.id] = r.status;
      totalRaw += r.items.length;
      fresh.push(...r.items);
    }
    // 全部失败时保留旧数据，避免站点被清空
    if (results.length && results.every((r) => !r.status.ok)) {
      state.sourceStatus = { ...emptyStatus(), ...status };
      state.lastError = '所有信源均采集失败，已保留上次数据';
      state.lastRefresh = state.lastRefresh || t0;
    } else {
      let items = dedupe(fresh);
      items = clusterExposure(items);
      items.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
      state.items = items;
      state.sourceStatus = { ...emptyStatus(), ...status };
      state.lastRefresh = Date.now();
      saveCache();
      console.log(`[store] 采集完成：原始 ${totalRaw} 条 → 去重聚类后 ${items.length} 条，耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  } catch (e) {
    state.lastError = String(e.message || e);
    console.error('[store] 采集失败:', e.message);
  } finally {
    state.refreshing = false;
  }
  return true;
}

function triggerRefresh() {
  refresh().catch((e) => {
    state.lastError = String(e.message || e);
    state.refreshing = false;
  });
}

function stats() {
  const byCategory = {};
  for (const k of CATEGORY_ORDER) byCategory[k] = 0;
  for (const it of state.items) if (byCategory[it.category] != null) byCategory[it.category]++;
  const okCount = Object.values(state.sourceStatus).filter((s) => s.ok).length;
  return {
    ok: true,
    items: state.items,
    total: state.items.length,
    byCategory,
    categories: CATEGORIES,
    categoryOrder: CATEGORY_ORDER,
    sources: SOURCES.map((s) => state.sourceStatus[s.id] || { id: s.id, name: s.name, ok: null, count: 0, error: null }),
    sourcesOk: okCount,
    sourcesTotal: SOURCES.length,
    lastRefresh: state.lastRefresh,
    refreshing: state.refreshing,
    lastError: state.lastError,
    startTime: state.startTime,
    windowHours: Math.round(MAX_AGE_MS / 3600e3),
    fetchedAt: Date.now(),
  };
}

function init(refreshMin) {
  loadCache();
  const stale = !state.lastRefresh || Date.now() - state.lastRefresh > refreshMin * 60e3;
  if (stale) {
    console.log('[store] 数据为空或已过期，启动自动采集…');
    setTimeout(() => triggerRefresh(), 500);
  } else {
    console.log(`[store] 缓存有效（${Math.round((Date.now() - state.lastRefresh) / 60e3)} 分钟前采集），等待定时刷新`);
  }
  setInterval(() => triggerRefresh(), refreshMin * 60e3).unref();
}

module.exports = { state, stats, refresh, triggerRefresh, init, refreshNow: refresh };
