// scripts/build.js
// 生成AI関連情報を複数ソースから集めて docs/index.html を生成し、
// 任意でメール通知も送る（my-portalと同じ構成）

import Parser from "rss-parser";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-portal-bot/1.0)" },
});

// ---------------------------------------------
// 1. 情報源の定義
// ---------------------------------------------

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

function googleNewsRssUrl(query) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
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

async function collectAll() {
  const tasks = [];

  for (const f of OFFICIAL_FEEDS) {
    tasks.push(fetchFeed(f.name, f.url, "official"));
  }
  for (const n of NEWS_QUERIES) {
    tasks.push(fetchFeed(n.name, googleNewsRssUrl(n.query), "news"));
  }

  const results = await Promise.all(tasks);
  let items = results.flat();

  // 日付でソート（新しい順）。日付不明のものは末尾へ
  items.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  // 直近7日以内のみ（日付不明は除外しない＝保険として残す）
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  items = items.filter((it) => {
    if (!it.pubDate) return true;
    const t = new Date(it.pubDate).getTime();
    if (Number.isNaN(t)) return true;
    return now - t <= SEVEN_DAYS;
  });

  // タイトル重複除去（同じニュースが複数ソースにヒットすることがあるため）
  const seen = new Set();
  items = items.filter((it) => {
    const key = it.title.replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return items;
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
  return `
  <a class="card" href="${item.link}" target="_blank" rel="noopener noreferrer">
    <div class="card-source">${escapeHtml(item.source)}</div>
    <div class="card-title">${escapeHtml(item.title)}</div>
    <div class="card-date">${formatDate(item.pubDate)}</div>
  </a>`;
}

function renderHtml(items) {
  const official = items.filter((i) => i.category === "official");
  const news = items.filter((i) => i.category === "news");
  const updatedAt = formatDate(new Date().toISOString());

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
  header {
    padding: 32px 20px 16px;
    text-align: center;
  }
  header h1 {
    margin: 0 0 6px;
    font-size: 28px;
    letter-spacing: 0.02em;
  }
  header p {
    margin: 0;
    color: #706b60;
    font-size: 13px;
  }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 8px 20px 60px;
  }
  section { margin-top: 36px; }
  section h2 {
    font-size: 16px;
    border-left: 4px solid var(--accent);
    padding-left: 10px;
    margin-bottom: 16px;
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
    color: var(--accent);
    font-weight: 600;
    margin-bottom: 6px;
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
</style>
</head>
<body>
<header>
  <h1>生成AI情報ポータル</h1>
  <p>最終更新: ${updatedAt}（自動更新 / GitHub Actions）</p>
</header>
<main>
  <section>
    <h2>公式ブログ・リリース</h2>
    <div class="grid">
      ${official.length ? official.map(renderCard).join("\n") : '<p class="empty">直近7日以内の更新はありませんでした。</p>'}
    </div>
  </section>
  <section>
    <h2>一般ニュース・関連報道</h2>
    <div class="grid">
      ${news.length ? news.map(renderCard).join("\n") : '<p class="empty">直近7日以内の更新はありませんでした。</p>'}
    </div>
  </section>
</main>
<footer>Powered by GitHub Actions ／ このページは自動生成されています</footer>
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
  const items = await collectAll();
  console.log(`[INFO] ${items.length} 件の記事を取得しました`);

  const html = renderHtml(items);
  const outDir = path.resolve("docs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf-8");
  console.log("[INFO] docs/index.html を更新しました");

  // 履歴として最新データもJSONで保存（任意）
  fs.writeFileSync(
    path.join(outDir, "latest.json"),
    JSON.stringify(items, null, 2),
    "utf-8"
  );

  try {
    await sendMail(items);
  } catch (err) {
    console.error("[WARN] メール送信でエラーが発生しました:", err.message);
  }
}

main().catch((err) => {
  console.error("[ERROR] 処理中にエラーが発生しました:", err);
  process.exit(1);
});
