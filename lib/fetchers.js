'use strict';
// ============================================================
// 全球 AI 信源采集器 —— 全部使用公开接口 / 公开 RSS，无需任何 API Key
// 每个 fetcher 返回原始条目数组，分类与去重由 classify.js / store.js 完成
// ============================================================

const MAX_AGE_MS = Number(process.env.MAX_AGE_H || 72) * 3600e3;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 AI-TopicRadar/1.0';

// ---------- 网络与解析工具 ----------

async function fetchText(url, { timeout = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ''; } });
}

const stripTags = (s) => decodeEntities(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * 通用 RSS 2.0 / Atom 解析器（正则实现，零依赖）
 */
function parseFeed(xml) {
  const blocks = xml.match(/<(entry|item)[\s>][\s\S]*?<\/\1>/g) || [];
  return blocks.map((b) => {
    const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
    const link =
      (b.match(/<link[^>]*href="([^"]+)"/) || b.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1];
    const guid = (b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [])[1];
    const pubDate =
      (b.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/) || [])[1];
    const desc =
      (b.match(/<(?:description|summary|content:encoded)[^>]*>([\s\S]*?)<\/(?:description|summary|content:encoded)>/) || [])[1];
    const creator = (b.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/) || [])[1];
    const names = [...b.matchAll(/<name[^>]*>([\s\S]*?)<\/name>/g)].map((m) => stripTags(m[1]));
    return {
      title: stripTags(title),
      link: stripTags(link) || stripTags(guid),
      pubDate: stripTags(pubDate),
      description: stripTags(desc).slice(0, 400),
      author: stripTags(creator) || names.join(', '),
      names,
    };
  }).filter((x) => x.title && x.link);
}

const in72h = (ts) => !ts || Date.now() - ts < MAX_AGE_MS;
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0));

// ---------- 通用 RSS 信源工厂 ----------

function rssSource(id, name, url, { kind = 'media', filter = null, author = null, category = null } = {}) {
  return {
    id, name, kind, category,
    async fetch() {
      const xml = await fetchText(url);
      let items = parseFeed(xml).filter((e) => in72h(parseDate(e.pubDate)));
      if (filter) items = items.filter((x) => filter(x.title + ' ' + x.description));
      return items.map((e) => ({
        title: e.title,
        url: e.link,
        author: e.author || author || name,
        publishedAt: parseDate(e.pubDate) || Date.now(),
        heat: 0,
        heatLabel: '',
        summary: e.description,
        kind,
      }));
    },
  };
}

// ---------- 具体信源 ----------

/** Hacker News（Algolia API）：AI 相关 + Show HN */
async function fetchHackerNews() {
  const since = Math.floor((Date.now() - MAX_AGE_MS) / 1000);
  const q = (extra) =>
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(extra)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=100`;
  const [a, b] = await Promise.all([fetchJson(q('AI')), fetchJson(q('Show HN'))]);
  const seen = new Set();
  const out = [];
  for (const h of [...(a.hits || []), ...(b.hits || [])]) {
    if (!h || seen.has(h.objectID)) continue;
    seen.add(h.objectID);
    const hnUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
    out.push({
      title: stripTags(h.title || ''),
      url: h.url || hnUrl,
      author: h.author || 'HN 用户',
      publishedAt: (h.created_at_i || 0) * 1000 || Date.now(),
      heat: (h.points || 0) + (h.num_comments || 0),
      heatLabel: `${h.points || 0} 赞 · ${h.num_comments || 0} 评论`,
      summary: h.story_text ? stripTags(h.story_text).slice(0, 300) : '',
      kind: 'community',
    });
  }
  return out;
}

/** Reddit：AI 相关板块（部分网络环境不可达，自动降级） */
async function fetchReddit() {
  const subs = [
    ['artificial', 'discussion'],
    ['MachineLearning', 'discussion'],
    ['LocalLLaMA', 'discussion'],
    ['OpenAI', 'discussion'],
    ['ChatGPT', 'discussion'],
    ['singularity', 'discussion'],
    ['SideProject', 'practical'],
  ];
  const out = [];
  for (const [sub, subKind] of subs) {
    const j = await fetchJson(`https://www.reddit.com/r/${sub}/hot.json?limit=25`);
    for (const c of j.data?.children || []) {
      const d = c.data;
      if (!d || d.stickied) continue;
      const ts = (d.created_utc || 0) * 1000;
      if (!in72h(ts)) continue;
      out.push({
        title: stripTags(d.title || '').slice(0, 300),
        url: d.is_self ? `https://www.reddit.com${d.permalink}` : d.url || '',
        author: d.author || 'Reddit 用户',
        publishedAt: ts || Date.now(),
        heat: (d.score || 0) + (d.num_comments || 0) * 2,
        heatLabel: `${d.score || 0} 赞 · ${d.num_comments || 0} 评论`,
        summary: d.selftext ? stripTags(d.selftext).slice(0, 300) : '',
        kind: subKind,
        sub: `r/${sub}`,
      });
    }
  }
  return out.filter((x) => x.url);
}

/** arXiv：AI 方向最新论文 */
async function fetchArxiv() {
  const url =
    'https://export.arxiv.org/api/query?search_query=' +
    encodeURIComponent('cat:cs.AI OR cat:cs.LG OR cat:cs.CL') +
    '&sortBy=submittedDate&sortOrder=descending&max_results=80';
  const xml = await fetchText(url);
  return parseFeed(xml)
    .filter((e) => in72h(parseDate(e.pubDate)))
    .map((e) => ({
      title: e.title,
      url: e.link,
      author: e.names.length
        ? `${e.names[0]}${e.names.length > 1 ? ` 等 ${e.names.length} 位作者` : ''}`
        : 'arXiv',
      publishedAt: parseDate(e.pubDate) || Date.now(),
      heat: 0,
      heatLabel: '新论文',
      summary: e.description.slice(0, 300),
      kind: 'paper',
    }));
}

/** HuggingFace Daily Papers */
async function fetchHfPapers() {
  const j = await fetchJson('https://huggingface.co/api/daily_papers');
  return (j || [])
    .filter((p) => in72h(parseDate(p.publishedAt || p.paper?.publishedAt)))
    .map((p) => {
      const d = p.paper || {};
      const names = (d.authors || []).map((a) => a.name).filter(Boolean);
      return {
        title: d.title || '',
        url: d.id ? `https://huggingface.co/papers/${d.id}` : '',
        author: names.slice(0, 3).join(', ') || 'HuggingFace Daily Papers',
        publishedAt: parseDate(p.publishedAt || d.publishedAt) || Date.now(),
        heat: p.upvotes || 0,
        heatLabel: `${p.upvotes || 0} 赞`,
        summary: (d.summary || '').slice(0, 300),
        kind: 'paper',
      };
    })
    .filter((x) => x.title && x.url);
}

/** HuggingFace 趋势模型（开源模型动态） */
async function fetchHfModels() {
  const j = await fetchJson('https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=60');
  return (j || [])
    .filter((m) => in72h(parseDate(m.lastModified)))
    .map((m) => ({
      title: m.id || '',
      url: `https://huggingface.co/${m.id}`,
      author: m.author || 'HuggingFace 社区',
      publishedAt: parseDate(m.createdAt) || parseDate(m.lastModified) || Date.now(),
      heat: m.downloads || 0,
      heatLabel: `${fmtNum(m.downloads || 0)} 下载`,
      summary: `${m.pipeline_tag || 'model'} · ${m.likes || 0} 赞`,
      kind: 'model',
    }));
}

/** GitHub：72 小时内新创建的高星 AI 仓库 */
async function fetchGithubRepos() {
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString().slice(0, 10);
  const q = `created:>${since} (ai OR llm OR agent OR gpt)`;
  const j = await fetchJson(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=50`,
    { headers: { Accept: 'application/vnd.github+json' } }
  );
  return (j.items || []).map((r) => ({
    title: r.full_name || '',
    url: r.html_url || '',
    author: r.owner?.login || '',
    publishedAt: parseDate(r.created_at) || Date.now(),
    heat: r.stargazers_count || 0,
    heatLabel: `⭐ ${fmtNum(r.stargazers_count || 0)}`,
    summary: (r.description || '').slice(0, 300),
    kind: r.topics?.includes('llm') || r.topics?.includes('machine-learning') ? 'repo' : 'tool',
    tags: r.topics || [],
  }));
}

/** Google News RSS（部分网络环境不可达，自动降级） */
function gnewsSource(id, name, q, { hl, gl, ceid, category }) {
  return {
    id, name, kind: 'media', category,
    async fetch() {
      const url =
        `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      const xml = await fetchText(url);
      return parseFeed(xml)
        .filter((e) => in72h(parseDate(e.pubDate)))
        .map((e) => {
          const parts = e.title.split(' - ');
          const pub = parts.length > 1 ? parts.pop() : '';
          return {
            title: parts.join(' - ') || e.title,
            url: e.link,
            author: pub || '新闻媒体',
            publishedAt: parseDate(e.pubDate) || Date.now(),
            heat: 0,
            heatLabel: '',
            summary: '',
            kind: 'media',
          };
        });
    },
  };
}

/** Anthropic 官方 News（HTML 页面抓取，无 RSS） */
const NAV_TEXT_RE = /^(product|products|models|solutions|pricing|research|news|company|security|careers|announcements|claude platform)$/i;

async function fetchAnthropic() {
  const html = await fetchText('https://www.anthropic.com/news');
  const seen = new Set();
  const out = [];
  const re = /<a\s+href="(\/news\/[a-z0-9-]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    // 截取该 <a> 的完整内部内容（最多 4000 字符）
    const from = m.index;
    const endIdx = html.indexOf('</a>', from + m[0].length);
    const inner = endIdx > from ? html.slice(from + m[0].length, Math.min(endIdx, from + 4000)) : '';
    const h2 = (inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    const spans = [...inner.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((x) => stripTags(x[1]));
    const title = stripTags(h2 || '').slice(0, 200)
      || spans.find((s) => s.length >= 10 && !NAV_TEXT_RE.test(s))?.slice(0, 200)
      || stripTags(inner).slice(0, 200);
    if (!title || title.length < 10 || NAV_TEXT_RE.test(title)) continue;
    const rest = html.slice(from, Math.min(from + 6000, html.length));
    const date = (rest.match(/<time[^>]*>([^<]*)<\/time>/) || [])[1];
    seen.add(slug);
    out.push({
      title,
      url: 'https://www.anthropic.com' + slug,
      author: 'Anthropic',
      publishedAt: parseDate(date) || Date.now(),
      heat: 0,
      heatLabel: '',
      summary: '',
      kind: 'blog',
    });
  }
  return out.filter((x) => in72h(x.publishedAt));
}

// ---------- 信源注册表 ----------

const SOURCES = [
  // —— 公开讨论（社区） ——
  { id: 'hackernews', name: 'Hacker News', kind: 'community', category: 'discussion', fetch: fetchHackerNews },
  { id: 'reddit', name: 'Reddit', kind: 'community', category: 'discussion', fetch: fetchReddit },

  // —— 曝光代理（全球媒体） ——
  gnewsSource('gnews_en', 'Google News · 英文', 'AI OR "artificial intelligence" when:3d', { hl: 'en-US', gl: 'US', ceid: 'US:en', category: 'exposure' }),
  gnewsSource('gnews_zh', 'Google News · 中文', '人工智能 when:3d', { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans', category: 'exposure' }),
  gnewsSource('gnews_jobs', 'Google News · 就业', 'AI hiring OR "AI jobs" OR "AI careers" when:3d', { hl: 'en-US', gl: 'US', ceid: 'US:en', category: 'jobs' }),
  rssSource('techcrunch', 'TechCrunch · AI', 'https://techcrunch.com/category/artificial-intelligence/feed/'),
  rssSource('venturebeat', 'VentureBeat · AI', 'https://venturebeat.com/category/ai/feed/'),
  rssSource('theverge', 'The Verge · AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'),
  rssSource('mit_techreview', 'MIT Tech Review · AI', 'https://www.technologyreview.com/topic/artificial-intelligence/feed'),
  rssSource('arstechnica', 'Ars Technica · AI', 'https://arstechnica.com/ai/feed/'),
  rssSource('wired', 'Wired · AI', 'https://www.wired.com/feed/tag/ai/latest/rss'),
  rssSource('qbitai', '量子位', 'https://www.qbitai.com/feed'),
  rssSource('ithome', 'IT之家', 'https://www.ithome.com/rss/', {
    kind: 'media',
    filter: (t) => /AI|人工智能|GPT|Claude|大模型|生成式|智能体|Copilot|AIGC|机器人|芯片/i.test(t),
  }),
  rssSource('sspai', '少数派', 'https://sspai.com/feed', {
    kind: 'tool', category: 'practical',
    filter: (t) => /AI|人工智能|GPT|Claude|大模型|生成式|智能体|Copilot|Midjourney|提示词|自动化|工作流|效率|AIGC/i.test(t),
  }),

  // —— 前沿变化（论文 / 模型 / 开源 / 官方博客） ——
  { id: 'arxiv', name: 'arXiv 论文', kind: 'paper', category: 'frontier', fetch: fetchArxiv },
  { id: 'hf_papers', name: 'HuggingFace 每日论文', kind: 'paper', category: 'frontier', fetch: fetchHfPapers },
  { id: 'hf_models', name: 'HuggingFace 趋势模型', kind: 'model', category: 'frontier', fetch: fetchHfModels },
  { id: 'github_repos', name: 'GitHub 新项目', kind: 'repo', category: 'frontier', fetch: fetchGithubRepos },
  rssSource('openai_blog', 'OpenAI 官方', 'https://openai.com/news/rss.xml', { kind: 'blog', category: 'frontier' }),
  { id: 'anthropic_news', name: 'Anthropic 官方', kind: 'blog', category: 'frontier', fetch: fetchAnthropic },
  rssSource('deepmind_blog', 'Google DeepMind', 'https://deepmind.google/blog/rss.xml', { kind: 'blog', category: 'frontier' }),
  rssSource('google_ai_blog', 'Google AI Blog', 'https://blog.google/technology/ai/rss/', { kind: 'blog', category: 'frontier' }),
  rssSource('apple_ml', 'Apple 机器学习研究', 'https://machinelearning.apple.com/rss.xml', { kind: 'blog', category: 'frontier' }),
  rssSource('hf_blog', 'HuggingFace 博客', 'https://huggingface.co/blog/feed.xml', { kind: 'blog', category: 'frontier' }),
  rssSource('langchain_blog', 'LangChain 博客', 'https://blog.langchain.dev/rss/', { kind: 'blog', category: 'frontier' }),
  rssSource('marktechpost', 'MarkTechPost', 'https://www.marktechpost.com/feed/', { kind: 'research-news', category: 'frontier' }),
  rssSource('simonwillison', 'Simon Willison（独立开发者）', 'https://simonwillison.net/atom/everything/', { kind: 'blog', category: 'frontier' }),
  rssSource('importai', 'Import AI（Jack Clark）', 'https://importai.substack.com/feed', { kind: 'blog', category: 'frontier' }),
];

module.exports = { SOURCES, parseFeed, parseDate, stripTags, in72h, fmtNum, MAX_AGE_MS };
