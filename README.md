# 📡 AI 选题雷达

自动收集并筛选 **全球 72 小时内的公开 AI 信息**，按五大维度归类，为内容创作者提供选题方向的网站。

- **曝光代理 📰**：哪些 AI 事件正在被更多媒体和平台提及（自动聚类计算"被 N 家媒体报道"）—— 大众正在关注的话题
- **公开讨论 💬**：Hacker News、Reddit 等社区讨论度最高的话题
- **前沿变化 🧪**：最新论文、模型、开源项目、官方发布 —— 普通人还没注意到的未来趋势
- **普通人落地 🛠️**：新办公工具、内容创作方法、自动化工作流 —— 可直接上手的选题
- **岗位与副业 💼**：从最新技术与市场信息中发现的新岗位需求和副业方向

每条信息均包含：**一句话概括、发布者、来源平台、热度、原文链接**，并支持一键复制"选题指令"发给 Codez 生成选题初稿，支持下载 HTML / Markdown 选题报告。

## 快速开始（Windows）

```bat
双击 start.bat
:: 或
node server.js
```

浏览器打开 http://localhost:8787 （手机在同一 Wi-Fi 下访问 http://<电脑IP>:8787）

首次启动会自动采集全部信源（约 30–90 秒），此后每 30 分钟自动刷新。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8787 | 监听端口 |
| `REFRESH_MIN` | 30 | 自动刷新间隔（分钟） |
| `MAX_AGE_H` | 72 | 数据时间窗口（小时） |
| `CACHE_FILE` | ./data/cache.json | 缓存文件路径 |

## 信源清单（全部公开接口，无需 API Key）

| 维度 | 信源 |
| --- | --- |
| 公开讨论 | Hacker News（Algolia）、Reddit（r/artificial、r/MachineLearning、r/LocalLLaMA、r/OpenAI、r/ChatGPT、r/singularity、r/SideProject） |
| 曝光代理 | Google News（英/中/就业三路）、TechCrunch、VentureBeat、The Verge、MIT Tech Review、Ars Technica、Wired、量子位、IT之家、少数派 |
| 前沿变化 | arXiv（cs.AI/LG/CL）、HuggingFace 每日论文与趋势模型、GitHub 新项目、OpenAI / Anthropic / DeepMind / Google AI / Apple ML / HuggingFace / LangChain 官方博客、MarkTechPost、Simon Willison、Import AI |
| 岗位与副业 | Google News 就业频道 + 全量关键词识别（招聘/副业/freelance/hiring…） |

> ⚠️ **网络说明**：Google News、Reddit、HuggingFace、Substack 在中国大陆网络环境可能无法直连，页面底部"信源状态"会如实显示；这些信源在国外服务器部署时即可全量工作。其余信源（Hacker News、arXiv、GitHub、TechCrunch、OpenAI、DeepMind、机器之心、少数派等）均可直连。

## 部署到服务器

### Koyeb 免费云平台（推荐，海外节点 · 全信源可用 · 免信用卡）

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/liguanwei8229-tech/Kenway&branch=main)

1. 点击上方按钮 → 用 GitHub 账号登录 Koyeb（首次需注册）
2. 实例类型选择 **Free**，端口保持 **8787**（已由 Dockerfile 自动识别）
3. 点击 **Deploy**，约 2 分钟完成
4. 打开 `https://你的应用名.koyeb.app` 即可使用，28 个信源全部可连

### Docker / 自建服务器

```bash
# Docker
docker build -t ai-topic-radar .
docker run -d --name ai-topic-radar -p 8787:8787 -v ai-radar-data:/app/data --restart unless-stopped ai-topic-radar

# 或直接运行 Node（建议用 pm2 / systemd 守护）
npm i -g pm2 && pm2 start server.js --name ai-topic-radar && pm2 save
```

部署后需在安全组/防火墙放行 8787 端口。建议部署在海外服务器以获得全部信源覆盖。

## API

| 端点 | 说明 |
| --- | --- |
| `GET /api/items` | 全部条目 + 分类统计 + 信源状态 |
| `POST /api/refresh` | 立即触发一次全量采集 |
| `GET /api/report.html` | 下载 HTML 选题报告（附件） |
| `GET /api/report.md` | 下载 Markdown 选题报告（附件） |
| `GET /api/health` | 健康检查 |

## 测试

```bash
node test/e2e.mjs
```

端到端测试覆盖：真实数据采集（五类均有数据）、字段完整性、原始链接可打开性（抽样 HEAD）、报告下载、桌面/手机页面（viewport 与响应式样式）。

## 项目结构

```
server.js           HTTP 服务入口（API + 静态资源 + 报告下载）
lib/fetchers.js     信源采集器（RSS/Atom/JSON/HTML 解析，零依赖）
lib/classify.js     五类智能分类 + 去重 + 媒体聚类（曝光度计算）
lib/store.js        定时采集、缓存落盘、并发控制
lib/report.js       HTML / Markdown 报告生成
public/             前端页面（原生 JS，桌面/手机自适应）
test/e2e.mjs        端到端验收测试
```

## 分类规则

1. **关键词优先**：命中岗位副业关键词（招聘/副业/freelance/hiring…）→ 岗位与副业；命中落地关键词（工具/工作流/自动化/教程…）→ 普通人落地
2. **信源默认**：媒体 → 曝光代理；社区 → 公开讨论；论文/模型/博客 → 前沿变化
3. **媒体聚类**：相似标题自动聚为一组，以"被 N 家媒体报道"表示曝光度
