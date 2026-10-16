**fix: 壊れた行の取り直しが失敗しても翻訳全体を止めず、その 1 文だけ捨てる**

## 何が変わるか
- 壊れた行の取り直しが 429・通信エラー・読めない応答で失敗しても、翻訳は止まらずその 1 文だけ抜けて残りが届く
- 取り直しの途中で中断した場合は、これまでどおり AbortError で止まる

## 人間に見てほしい点
- 取り直しの失敗はどこにも知らせず、黙ってその文を捨てる（issue の制約どおり）。抜けた文に利用者が気付けなくてよいか

<details><summary>受入条件</summary>

- [ ] AC-1 ストリームの途中に壊れた JSON の行があり、その取り直しのリクエストが 429 を返すとき、`translateStream` は reject せず、壊れた行の前後にある正しい文をすべて `onSentence` に渡して resolve する。文番号 `i` は 0 から欠番なしの通し番号になる。`src/lib/groq.test.ts` で確かめる
- [ ] AC-2 取り直しのリクエストが通信エラー（fetch の reject）になる場合と、応答の本文が JSON として読めない場合も、AC-1 と同じく残りの文を渡して resolve する。`src/lib/groq.test.ts` で確かめる
- [ ] AC-3 取り直しの途中で `signal` が中断されたとき（fetch が `AbortError` で reject したとき）は、これまでどおり `translateStream` が `AbortError` で reject する。`src/lib/groq.test.ts` で確かめる
- [ ] AC-4 段落の最初のストリーミングのリクエストが 401・429・通信エラーになるときは、これまでどおり `translateStream` が対応する `GroqError` で reject する（既存テストが通る）。`pnpm typecheck`・`pnpm test`・`pnpm build` がすべて通る

</details>

<details><summary>設計判断</summary>

- 例外は retryLine の中で受け止める — 段落ストリーミングのエラー処理と toGroqError を変えず、取り直しの経路だけを変えるため
- AbortError だけは投げ直す — AC-3 のとおり、利用者の中断では翻訳全体を止める必要があるため

</details>

<details><summary>検証</summary>

- danger-grep: なし
- test-surface: なし
- 検証: pnpm exec vitest run src/lib/groq.test.ts: 25 件すべて通過（追加は 4 件: 取り直しが 429・通信エラー・JSON でない本文の 3 通りと、取り直し中の AbortError）。pnpm typecheck と pnpm build も成功。

</details>

Closes #4
