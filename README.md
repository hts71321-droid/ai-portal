# 生成AI情報ポータル (ai-portal)

my-portal と同じ構成（Node.js + GitHub Actions + nodemailer）で作った、
**生成AI関連情報だけに特化した自動更新まとめサイト**です。

- 毎日 GitHub Actions が自動実行され、最新記事を集めて `docs/index.html` を更新
- GitHub Pages で誰でも閲覧できるサイトとして公開
- 更新内容を自分宛にメール通知（Gmailのアプリパスワード使用・my-portalと同じ方式）

情報源:
- 公式ブログ（RSS）: OpenAI / Google DeepMind / Hugging Face / Microsoft Research / MIT News(AI)
- 一般ニュース: Googleニュース検索RSS（Anthropic/Claude, 生成AI, ChatGPT, Gemini, Copilot など）
  ※Anthropicは公式RSSが存在しないため、こちらでカバーしています

---

## セットアップ手順

### ① このフォルダをGitHubリポジトリにする

1. GitHubで新しいリポジトリを作成（Public推奨。Privateだと後述のPages設定に有料プランが必要な場合あり）
2. このフォルダの中身をそのままアップロード（GitHub Desktop推奨）
   - `git init` → `git add .` → `git commit -m "init"` → GitHubのリポジトリへpush

### ② Gmailアプリパスワードを準備（メール通知を使う場合のみ）

my-portalで使ったものと同じ仕組みです。まだ無い場合は：
1. Googleアカウント → セキュリティ → 2段階認証を有効化
2. 「アプリパスワード」を作成（16桁の文字列が発行される）

### ③ GitHubリポジトリにSecretsを登録

リポジトリの `Settings` → `Secrets and variables` → `Actions` → `New repository secret` から、以下3つを登録：

| Name | 値 |
|---|---|
| `GMAIL_USER` | 送信元Gmailアドレス |
| `GMAIL_APP_PASSWORD` | ②で発行した16桁のアプリパスワード |
| `MAIL_TO` | 通知を受け取りたいメールアドレス（自分宛でOK） |

※メール通知が不要な場合はSecretsを登録しなくてもOK（自動でスキップされます）

### ④ GitHub Pagesを有効化

`Settings` → `Pages` → `Source` を `Deploy from a branch` にして、
`Branch: main` / フォルダを `/docs` に設定 → Save

数分後、`https://(あなたのユーザー名).github.io/(リポジトリ名)/` でサイトが見られるようになります。

### ⑤ 動作確認（手動実行）

`Actions` タブ → `Update AI Portal` を選択 → `Run workflow` で手動実行できます。
成功すれば `docs/index.html` が自動更新され、コミットが作られます。

---

## カスタマイズ

- **更新頻度を変えたい** → `.github/workflows/update.yml` の `cron` を編集
  （例: 1日2回なら `"0 0,12 * * *"`）
- **情報源を追加/変更したい** → `scripts/build.js` の `OFFICIAL_FEEDS` / `NEWS_QUERIES` を編集
- **見た目を変えたい** → `scripts/build.js` 内の `<style>` 部分を編集

## ローカルで試したい場合

```bash
npm install
node scripts/build.js
```

`docs/index.html` が生成されます（メール送信は環境変数が無ければ自動スキップされます）。
