// scripts/build.js
// 生成AI関連情報を複数ソースから集めて docs/index.html を生成し、
// 任意でメール通知も送る（my-portalと同じ構成）
// 記事は Claude / Copilot / GPT / Gemini / その他 のトピックに自動分類し、
// トップのヒーロータブで切り替えられる。各トピックにはYouTube動画も表示する。

import Parser from "rss-parser";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-portal-bot/1.0)" },
});

// ---------------------------------------------
// 1. トピックと情報源の定義
// ---------------------------------------------

const TOPICS = [
  { id: "claude", label: "Claude", icon: "✴️", color: "#b5673a", desc: "Anthropic / Claude" },
  { id: "copilot", label: "Copilot", icon: "🚁", color: "#6e40c9", desc: "GitHub / Microsoft Copilot" },
  { id: "gpt", label: "GPT", icon: "🌀", color: "#10a37f", desc: "OpenAI / ChatGPT" },
  { id: "gemini", label: "Gemini", icon: "💠", color: "#4285f4", desc: "Google / Gemini" },
  { id: "other", label: "その他", icon: "📰", color: "#9a9488", desc: "生成AI全般" },
];

// タイトル・ソース名からトピックを判定（上から順に優先）
function classifyTopic(...texts) {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/claude|anthropic/.test(t)) return "claude";
  if (/copilot|github/.test(t)) return "copilot";
  if (/chatgpt|openai|\bgpt-?\d|\bgpt\b|\bsora\b/.test(t)) return "gpt";
  if (/gemini|deepmind|notebooklm|\bbard\b|google ai|google の ai|googleのai/.test(t)) return "gemini";
  return "other";
}

// 公式ブログ系（RSS配信が確認できているもの）
const OFFICIAL_FEEDS = [
  { name: "OpenAI", url: "https://openai.com/news/rss.xml" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml" },
  { name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml" },
  { name: "Microsoft Research", url: "https://www.microsoft.com/en-us/research/feed/" },
  { name: "MIT News (AI)", url: "https://news.mit.edu/rss/topic/artificial-intelligence2" },
];

// Anthropicは公式RSSが無いため、Googleニュース検索で代替
// また「一般ニュース」枠として日本語の生成AI関連キーワードも検索
const NEWS_QUERIES = [
  { name: "Anthropic / Claude", query: "Anthropic Claude" },
  { name: "生成AI 総合", query: "生成AI" },
  { name: "ChatGPT / OpenAI 関連", query: "ChatGPT OR OpenAI" },
  { name: "Gemini / Google AI 関連", query: "Gemini AI Google" },
  { name: "Copilot / Microsoft AI 関連", query: "Copilot Microsoft AI" },
];

// 公式YouTubeチャンネル（チャンネルRSS）
const YOUTUBE_CHANNELS = [
  { name: "Anthropic", topic: "claude", channelId: "UCrDwWp7EBBv4NwvScIpBDOA" },
  { name: "OpenAI", topic: "gpt", channelId: "UCXZCJLdBC09xxGZ6gcdrc6A" },
  { name: "Google DeepMind", topic: "gemini", channelId: "UCP7jMXSY2xbc3KCAE0MHQ-A" },
  { name: "GitHub", topic: "copilot", channelId: "UC7c3Kb6jYCRj4JOHHZTxKsQ" },
  { name: "Microsoft 365 Copilot", topic: "copilot", channelId: "UCBcPPMQmVe5O3on4v5VKrYA" },
];

function googleNewsRssUrl(query) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
}

function youtubeRssUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

// ---------------------------------------------
// 2. 各フィードを取得（1件失敗しても全体は止めない）
// ---------------------------------------------

async function fetchFeed(name, url, category) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).map((item) => ({
      source: name,
      category,
      title: (item.title || "").trim(),
      link: item.link,
      pubDate: item.pubDate || item.isoDate || null,
      snippet: (item.contentSnippet || "").slice(0, 140),
    }));
  } catch (err) {
    console.error(`[WARN] ${name} の取得に失敗: ${err.message}`);
    return [];
  }
}

async function fetchYoutube(ch) {
  try {
    const feed = await parser.parseURL(youtubeRssUrl(ch.channelId));
    return (feed.items || []).map((item) => {
      const videoId = (item.id || "").replace(/^yt:video:/, "");
      return {
        source: ch.name,
        topic: ch.topic,
        title: (item.title || "").trim(),
        link: item.link || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ""),
        pubDate: item.pubDate || item.isoDate || null,
        videoId,
        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "",
      };
    });
  } catch (err) {
    console.error(`[WARN] YouTube(${ch.name}) の取得に失敗: ${err.message}`);
    return [];
  }
}

function sortByDateDesc(items) {
  items.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });
  return items;
}

async function collectAll() {
  const articleTasks = [];
  for (const f of OFFICIAL_FEEDS) {
    articleTasks.push(fetchFeed(f.name, f.url, "official"));
  }
  for (const n of NEWS_QUERIES) {
    articleTasks.push(fetchFeed(n.name, googleNewsRssUrl(n.query), "news"));
  }
  const videoTasks = YOUTUBE_CHANNELS.map(fetchYoutube);

  const [articleResults, videoResults] = await Promise.all([
    Promise.all(articleTasks),
    Promise.all(videoTasks),
  ]);

  let articles = sortByDateDesc(articleResults.flat());

  // 直近7日以内のみ（日付不明は除外しない＝保険として残す）
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  articles = articles.filter((it) => {
    if (!it.pubDate) return true;
    const t = new Date(it.pubDate).getTime();
    if (Number.isNaN(t)) return true;
    return now - t <= SEVEN_DAYS;
  });

  // タイトル重複除去（同じニュースが複数ソースにヒットすることがあるため）
  const seen = new Set();
  articles = articles.filter((it) => {
    const key = it.title.replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // トピック分類
  for (const it of articles) {
    it.topic = classifyTopic(it.title, it.source, it.snippet);
  }

  // 動画は直近30日以内・チャンネルごとに最新6本まで（トピックが空になりにくいように）
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const perChannel = new Map();
  let videos = sortByDateDesc(videoResults.flat()).filter((v) => {
    if (v.pubDate) {
      const t = new Date(v.pubDate).getTime();
      if (!Number.isNaN(t) && now - t > THIRTY_DAYS) return false;
    }
    const count = perChannel.get(v.source) || 0;
    if (count >= 6) return false;
    perChannel.set(v.source, count + 1);
    return true;
  });

  return { articles, videos };
}

// ---------------------------------------------
// 3. HTML生成
// ---------------------------------------------

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderCard(item) {
  const officialBadge =
    item.category === "official" ? '<span class="badge-official">公式</span>' : "";
  return `
  <a class="card" href="${escapeHtml(item.link || "")}" target="_blank" rel="noopener noreferrer">
    <div class="card-source">${escapeHtml(item.source)}${officialBadge}</div>
    <div class="card-title">${escapeHtml(item.title)}</div>
    <div class="card-date">${formatDate(item.pubDate)}</div>
  </a>`;
}

function renderVideoCard(v) {
  return `
  <a class="video-card" href="${escapeHtml(v.link)}" target="_blank" rel="noopener noreferrer">
    <div class="video-thumb">
      <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" />
      <span class="video-play">▶</span>
    </div>
    <div class="video-body">
      <div class="video-title">${escapeHtml(v.title)}</div>
      <div class="video-meta">${escapeHtml(v.source)}・${formatDate(v.pubDate)}</div>
    </div>
  </a>`;
}

const MAX_NEWS_PER_TOPIC = 30;

function renderTopicSection(topic, articles, videos) {
  const official = articles.filter((a) => a.category === "official");
  const news = articles.filter((a) => a.category === "news").slice(0, MAX_NEWS_PER_TOPIC);
  const shown = sortByDateDesc([...official, ...news]);

  const videoBlock = videos.length
    ? `
    <h3 class="sub-heading">▶ YouTube動画</h3>
    <div class="video-row">
      ${videos.map(renderVideoCard).join("\n")}
    </div>`
    : "";

  const articleBlock = shown.length
    ? `<div class="grid">${shown.map(renderCard).join("\n")}</div>`
    : '<p class="empty">直近7日以内の記事はありませんでした。</p>';

  return `
  <section class="topic-section" id="topic-${topic.id}" data-topic="${topic.id}" style="--topic-color: ${topic.color}">
    <h2><span class="topic-icon">${topic.icon}</span>${escapeHtml(topic.label)}
      <span class="topic-desc">${escapeHtml(topic.desc)}</span>
      <span class="topic-count">${shown.length}件${videos.length ? ` / 動画${videos.length}本` : ""}</span>
    </h2>
    ${videoBlock}
    <h3 class="sub-heading">📄 記事・ニュース</h3>
    ${articleBlock}
  </section>`;
}

function renderHtml({ articles, videos }) {
  const updatedAt = formatDate(new Date().toISOString());

  const tabs = [
    `<button class="tab active" data-topic="all">すべて</button>`,
    ...TOPICS.map((t) => {
      const n = articles.filter((a) => a.topic === t.id).length;
      return `<button class="tab" data-topic="${t.id}" style="--topic-color: ${t.color}">${t.icon} ${escapeHtml(t.label)}<span class="tab-count">${n}</span></button>`;
    }),
  ].join("\n");

  const sections = TOPICS.map((t) =>
    renderTopicSection(
      t,
      articles.filter((a) => a.topic === t.id),
      videos.filter((v) => v.topic === t.id)
    )
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>生成AI情報ポータル</title>
<style>
  :root {
    --bg: #faf9f6;
    --ink: #2b2b28;
    --accent: #b5673a; /* terracotta */
    --card-bg: #ffffff;
    --border: #e6e2da;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
    line-height: 1.6;
  }
  .hero {
    background: linear-gradient(135deg, #2b2b28 0%, #4a3728 60%, #b5673a 100%);
    color: #faf9f6;
    text-align: center;
    padding: 36px 20px 0;
  }
  .hero h1 {
    margin: 0 0 6px;
    font-size: 28px;
    letter-spacing: 0.02em;
  }
  .hero p {
    margin: 0 0 20px;
    color: rgba(250,249,246,0.75);
    font-size: 13px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    justify-content: flex-start;
    overflow-x: auto;
    max-width: 960px;
    margin: 0 auto;
    padding: 0 4px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    --topic-color: var(--accent);
    flex-shrink: 0;
    appearance: none;
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: rgba(250,249,246,0.8);
    background: rgba(255,255,255,0.08);
    border-radius: 10px 10px 0 0;
    padding: 10px 18px;
    transition: background .15s, color .15s;
  }
  .tab:hover { background: rgba(255,255,255,0.18); }
  .tab.active {
    background: var(--bg);
    color: var(--ink);
  }
  .tab-count {
    display: inline-block;
    margin-left: 6px;
    font-size: 11px;
    font-weight: 600;
    background: var(--topic-color);
    color: #fff;
    border-radius: 999px;
    padding: 0 7px;
  }
  .tab[data-topic="all"] .tab-count { display: none; }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 8px 20px 60px;
  }
  .topic-section { margin-top: 36px; }
  .topic-section h2 {
    font-size: 18px;
    border-left: 4px solid var(--topic-color);
    padding-left: 10px;
    margin-bottom: 6px;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .topic-icon { font-size: 16px; }
  .topic-desc {
    font-size: 12px;
    font-weight: 400;
    color: #9a9488;
  }
  .topic-count {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    color: var(--topic-color);
  }
  .sub-heading {
    font-size: 13px;
    color: #706b60;
    margin: 18px 0 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
  }
  .card {
    display: block;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
    text-decoration: none;
    color: var(--ink);
    transition: box-shadow .15s, transform .15s;
  }
  .card:hover {
    box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    transform: translateY(-2px);
  }
  .card-source {
    font-size: 11px;
    color: var(--topic-color, var(--accent));
    font-weight: 600;
    margin-bottom: 6px;
  }
  .badge-official {
    display: inline-block;
    margin-left: 6px;
    font-size: 10px;
    background: var(--topic-color, var(--accent));
    color: #fff;
    border-radius: 4px;
    padding: 0 5px;
  }
  .card-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .card-date {
    font-size: 11px;
    color: #9a9488;
  }
  .video-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 240px;
    gap: 14px;
    overflow-x: auto;
    padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
  }
  .video-card {
    display: block;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    text-decoration: none;
    color: var(--ink);
    transition: box-shadow .15s, transform .15s;
  }
  .video-card:hover {
    box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    transform: translateY(-2px);
  }
  .video-thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #000;
  }
  .video-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .video-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    color: #fff;
    background: rgba(0,0,0,0.25);
    opacity: 0;
    transition: opacity .15s;
  }
  .video-card:hover .video-play { opacity: 1; }
  .video-body { padding: 10px 12px; }
  .video-title {
    font-size: 13px;
    font-weight: 600;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .video-meta {
    margin-top: 6px;
    font-size: 11px;
    color: #9a9488;
  }
  footer {
    text-align: center;
    color: #9a9488;
    font-size: 11px;
    padding: 20px;
  }
  .empty {
    color: #9a9488;
    font-size: 13px;
  }
  body.filtered .topic-section { display: none; }
  body.filtered .topic-section.visible { display: block; }
</style>
</head>
<body>
<header class="hero">
  <h1>生成AI情報ポータル</h1>
  <p>最終更新: ${updatedAt}（自動更新 / GitHub Actions）</p>
  <nav class="tabs" id="tabs">
    ${tabs}
  </nav>
</header>
<main>
  ${sections}
</main>
<footer>Powered by GitHub Actions ／ このページは自動生成されています</footer>
<script>
  (function () {
    var tabs = document.querySelectorAll("#tabs .tab");
    var sections = document.querySelectorAll(".topic-section");

    function select(topic) {
      tabs.forEach(function (t) {
        t.classList.toggle("active", t.dataset.topic === topic);
      });
      if (topic === "all") {
        document.body.classList.remove("filtered");
      } else {
        document.body.classList.add("filtered");
        sections.forEach(function (s) {
          s.classList.toggle("visible", s.dataset.topic === topic);
        });
      }
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        var topic = t.dataset.topic;
        select(topic);
        if (topic === "all") {
          history.replaceState(null, "", location.pathname);
        } else {
          history.replaceState(null, "", "#" + topic);
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    // URLハッシュ（#claude など）で直接トピックを開けるように
    var hash = location.hash.replace("#", "");
    var valid = Array.prototype.some.call(sections, function (s) {
      return s.dataset.topic === hash;
    });
    if (valid) select(hash);
  })();
</script>
</body>
</html>
`;
}

// ---------------------------------------------
// 4. メール送信（my-portalと同じ nodemailer + Gmailアプリパスワード方式）
// ---------------------------------------------

async function sendMail(items) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.MAIL_TO || user;

  if (!user || !pass) {
    console.log("[INFO] GMAIL_USER / GMAIL_APP_PASSWORD 未設定のためメール送信をスキップします");
    return;
  }

  const official = items.filter((i) => i.category === "official").slice(0, 10);
  const news = items.filter((i) => i.category === "news").slice(0, 10);

  const listText = (arr) =>
    arr.length
      ? arr.map((i) => `・[${i.source}] ${i.title}\n  ${i.link}`).join("\n")
      : "（直近の更新はありません）";

  const body = `生成AI情報ポータル 更新通知

■ 公式ブログ・リリース
${listText(official)}

■ 一般ニュース・関連報道
${listText(news)}

---
自動送信メール（GitHub Actions）
`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: user,
    to,
    subject: `【生成AI情報ポータル】更新通知 ${new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
    text: body,
  });

  console.log("[INFO] メール送信完了");
}

// ---------------------------------------------
// 5. メイン処理
// ---------------------------------------------

async function main() {
  console.log("[INFO] 情報収集を開始します...");
  const { articles, videos } = await collectAll();
  console.log(`[INFO] 記事 ${articles.length} 件・動画 ${videos.length} 本を取得しました`);

  const html = renderHtml({ articles, videos });
  const outDir = path.resolve("docs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf-8");
  console.log("[INFO] docs/index.html を更新しました");

  // 履歴として最新データもJSONで保存（任意）
  fs.writeFileSync(
    path.join(outDir, "latest.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), articles, videos }, null, 2),
    "utf-8"
  );

  try {
    await sendMail(articles);
  } catch (err) {
    console.error("[WARN] メール送信でエラーが発生しました:", err.message);
  }
}

main().catch((err) => {
  console.error("[ERROR] 処理中にエラーが発生しました:", err);
  process.exit(1);
});
