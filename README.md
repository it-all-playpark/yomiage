# yomiage

Groq で翻訳と読み付けを行い、ブラウザの音声で読み上げる Web アプリ（API key はブラウザにだけ保存）

外国語の文章を日本語に訳し、漢字の熟語や固有名詞を正しい読みで読み上げます。読みを間違えたら、訳文の語をクリックしてその場で直せます。

## ドキュメント

- [要件定義](docs/requirements.md)：背景・目的・決定事項・機能要件
- [実装仕様](docs/spec.md)：構成・Groq とのやり取り・読みの決め方・保存形式・実装前の検証項目
- [UI モック](docs/mock/README.md)：3 画面のモックと見た目の決まり

## 使い方（利用者向け）

1. [Groq](https://console.groq.com) に無料で登録し、API key を作る
2. このアプリを開き、設定画面で key を貼り付ける（key はブラウザにだけ保存され、開発者のサーバーには送られません）
3. 原文を貼って「翻訳する」

公開 URL は、GitHub Pages で公開した後に追記します。

## 開発

必要なもの：Node.js 24、pnpm

```sh
pnpm install
pnpm dev        # 開発サーバー（http://localhost:5173）
pnpm test       # Vitest
pnpm typecheck  # 型チェック
pnpm build      # dist/ に静的ファイルを出力
pnpm preview    # dist/ を配信して確認
```

- kuromoji の辞書（`node_modules/kuromoji/dict/*.dat.gz`）は、`dev` / `build` / `test` の前に `scripts/copy-dict.mjs` が `public/dict/` にコピーする（`public/dict/` は git に入れない）。手で実行するときは `pnpm copy-dict`
- 辞書は gzip のままブラウザに届け、kuromoji が解凍する。Vite の dev / preview サーバーは `.gz` に `Content-Encoding: gzip` を付けてブラウザに先に解凍させてしまうので、`vite.config.ts` で `.dat.gz` だけこのヘッダーを外している
- 画面はハッシュで切り替える（`#/` 翻訳、`#/setup` 設定、`#/dict` 読み辞書）

## 公開

`main` に push すると `.github/workflows/pages.yml` がテスト・ビルドして GitHub Pages に公開する。初回はリポジトリの Settings → Pages で Source を「GitHub Actions」にする。
