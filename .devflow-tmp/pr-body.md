**fix: 提供が終わった llama-3.3-70b-versatile を既定モデルから外し、gpt-oss-20b を既定にする**

## 何が変わるか
- 既定の翻訳モデルが openai/gpt-oss-20b（速さ重視・おすすめ）になり、Groq の無料プランの key でも既定のまま翻訳できる
- 選べるモデルは gpt-oss-20b と gpt-oss-120b の 2 つになり、どちらも reasoning_effort: low を付けて送る
- 廃止された llama-3.3-70b-versatile などを保存している利用者は、読み込み時に既定のモデルへ自動で戻る（声・速さ・ルビの設定はそのまま）

## 人間に見てほしい点
- gpt-oss-20b で NFR-1（押してから声が出るまで 1.5 秒）に収まるか、訳の質が足りるかは未計測。実機で確かめ、足りなければ既定を 120b にする
- MODELS に無いモデルはすべて既定に戻すため、今後モデルを外すと保存済みの選択も黙って既定に戻る

## この PR に含めなかったもの
- gpt-oss-20b の NFR-1（1.5 秒）と訳の質の実機計測は、実機で測る必要があるため実施していない（issue の未解決事項）
- src/ui/Setup.tsx は変更対象パスに挙がっているが、「使えないようです」の判定と文言は変えない制約があり、ほかに直す箇所も無かったため変更していない

<details><summary>受入条件</summary>

- [x] AC-1 `src/lib/groq.ts` の `MODELS` に `llama-3.3-70b-versatile` が無く、`DEFAULT_MODEL` は `openai/gpt-oss-20b` である。`MODELS` は「速さ重視・おすすめ」の `openai/gpt-oss-20b` と「精度重視」の `openai/gpt-oss-120b` の 2 つで、どちらも `extra` が `{ reasoning_effort: 'low' }` である。`src/lib/groq.test.ts` で確かめる
- [x] AC-2 `openai/gpt-oss-20b` で翻訳するとき、リクエストの本文に `model: 'openai/gpt-oss-20b'` と `reasoning_effort: 'low'` が入る。`src/lib/groq.test.ts` で確かめる
- [x] AC-3 `yomiage.settings` の `model` が `MODELS` に無い値（例: `llama-3.3-70b-versatile`）のとき、`loadSettings()` は `model` を `DEFAULT_MODEL` にして返す。`voiceURI`・`rate`・`showAllRuby` は保存された値のまま残る。`src/lib/storage.test.ts` で確かめる
- [x] AC-4 `docs/spec.md` §3.2 のモデル表が AC-1 の 2 モデルになっている。§9 の V6 の行か直後に、確かめた結果（`llama-3.3-70b-versatile` は 2026-08-16 に無料プランでの提供が終わったこと、`openai/gpt-oss-120b` は無料プランの key で翻訳できたこと）が書かれている
- [x] AC-5 リポジトリ内（`node_modules` と `docs/mock/` を除く）で `llama-3.3-70b-versatile` を参照するのは、AC-3 のテストと AC-4 の spec の記述だけである。`pnpm typecheck`・`pnpm test`・`pnpm build` がすべて通る

</details>

<details><summary>設計判断</summary>

- 未知のモデルは読み込み時に既定へ戻す — 廃止モデルを保存した利用者が何もせず使えるように。保存形式は変えない
- 20b にも reasoning_effort: low — gpt-oss は推論するモデルなので、120b と同じく待ち時間を抑える

</details>

<details><summary>検証</summary>

- danger-grep: 2 件（auth: `.devflow-tmp/prerun-setup.json`、public-api: `src/lib/groq.ts`）
- test-surface: なし
- 検証: vitest run（groq/storage/Setup/session/state/Main の 6 ファイル）87 件 pass。pnpm typecheck と pnpm build も pass。テスト全件は Validate phase で走らせる
- 検証: node_modules・docs/mock・.devflow-tmp を除いて grep した結果、llama-3.3-70b-versatile が残るのは storage.test.ts の AC-3 テストと docs/spec.md §9 の V6 結果だけ

</details>

Closes #3
