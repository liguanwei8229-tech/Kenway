'use strict';
// ============================================================
// 五类智能分类 + 去重 + 媒体聚类（曝光度计算）
// 分类优先级：岗位与副业 > 普通人落地 > 信源默认分类
// ============================================================

const CATEGORIES = {
  exposure:   { id: 'exposure',   label: '曝光代理',   emoji: '📰', color: '#e5484d', desc: '被更多媒体和平台提及的 AI 事件' },
  discussion: { id: 'discussion', label: '公开讨论',   emoji: '💬', color: '#3b82f6', desc: '各大社区讨论度最高的 AI 话题' },
  frontier:   { id: 'frontier',   label: '前沿变化',   emoji: '🧪', color: '#8b5cf6', desc: '最新模型、论文与功能变化' },
  practical:  { id: 'practical',  label: '普通人落地', emoji: '🛠️', color: '#16a34a', desc: '普通人可上手的工具、工作流与创作方法' },
  jobs:       { id: 'jobs',       label: '岗位与副业', emoji: '💼', color: '#d97706', desc: '新出现的岗位需求与副业方向' },
};

const CATEGORY_ORDER = ['exposure', 'discussion', 'frontier', 'practical', 'jobs'];

// 岗位与副业关键词（命中即归类，优先级最高）
const JOBS_RE = /hiring|hire\b|job\b|jobs\b|career|salary|salaries|layoff|laid off|招聘|求职|岗位|薪资|副业|兼职|freelance|side hustle|side business|side project income|make money|赚钱|变现|monetiz|gig econom|remote work|裁员|upwork|fiverr|简历|offer|跳槽|转行/i;

// 普通人落地关键词（命中即归类，优先级第二）
const PRACTICAL_RE = /tool\b|tools\b|workflow|automation|自动化|工作流|no-?code|productivity|效率|tutorial|教程|上手|extension|插件|excel|office|办公|content creation|内容创作|template|模板|notion|obsidian|chrome\b|短视频|剪辑|写作助手|视频生成|图片生成|image generation|文案|简历|浏览器|桌面应用|小程序|模板工具|免费工具|开源工具/i;

function defaultCategory(kind) {
  switch (kind) {
    case 'media': return 'exposure';
    case 'community': return 'discussion';
    case 'tool': return 'practical';
    default: return 'frontier';
  }
}

function classifyItem(it, source) {
  it.sourceId = source.id;
  it.source = it.sub ? `${source.name} · ${it.sub}` : source.name;
  const text = `${it.title} ${it.summary || ''} ${(it.tags || []).join(' ')}`;
  let cat = source.category || defaultCategory(it.kind);
  if (JOBS_RE.test(text)) cat = 'jobs';
  else if (PRACTICAL_RE.test(text)) cat = 'practical';
  it.category = cat;
  return it;
}

// ---------- 按 URL 去重（合并跨平台转载） ----------

function dedupe(items) {
  const byUrl = new Map();
  for (const it of items) {
    if (!it.url) continue;
    const key = it.url.split('#')[0].replace(/\/$/, '');
    const prev = byUrl.get(key);
    if (!prev) {
      it.platforms = [it.sourceId];
      byUrl.set(key, it);
      continue;
    }
    // 同一条内容被多个平台提到：合并平台信息，取更高热度
    prev.platforms = [...new Set([...(prev.platforms || []), it.sourceId])];
    if (!prev.summary && it.summary) prev.summary = it.summary;
    if ((it.heat || 0) > (prev.heat || 0)) {
      prev.heat = it.heat;
      prev.heatLabel = it.heatLabel;
    }
    if (it.category === 'practical' && prev.category !== 'practical' && prev.category !== 'jobs') {
      prev.category = 'practical'; // 社区/媒体转载的落地工具，保留落地属性
    }
  }
  return [...byUrl.values()];
}

// ---------- 媒体聚类：计算“曝光度”（多少家媒体报道了同一事件） ----------

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokens(t) {
  const words = normTitle(t).split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (/[一-鿿]/.test(w)) {
      for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); // 中文二元组
    } else {
      out.push(w);
    }
  }
  return out;
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function clusterExposure(items) {
  const media = items.filter((x) => x.category === 'exposure');
  const others = items.filter((x) => x.category !== 'exposure');
  const clusters = [];
  for (const it of media) {
    const ta = tokens(it.title);
    if (ta.length < 4) {
      it.mentions = 1;
      it.coverage = [it.source];
      it.heatLabel = '1 家媒体报道';
      others.push(it);
      continue;
    }
    let best = null;
    for (const c of clusters) {
      const score = jaccard(ta, c.tokens);
      if (score >= 0.35 && (!best || score > best.score)) best = { c, score };
    }
    if (best) best.c.members.push(it);
    else clusters.push({ tokens: ta, members: [it] });
  }
  for (const c of clusters) {
    c.members.sort((a, b) => (b.heat || 0) - (a.heat || 0) || (b.publishedAt || 0) - (a.publishedAt || 0));
    const rep = c.members[0];
    rep.mentions = c.members.length;
    rep.coverage = [...new Set(c.members.map((m) => m.source))];
    rep.heatLabel = `${c.members.length} 家媒体报道`;
    others.push(rep);
  }
  return others;
}

module.exports = { CATEGORIES, CATEGORY_ORDER, classifyItem, dedupe, clusterExposure };
