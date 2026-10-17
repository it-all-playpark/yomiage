// 翻訳と読み上げ（FR-2〜4）。モックは docs/mock/Main.dc.html
import { useEffect, useState } from 'preact/hooks';
import type { Token } from '../types';
import { analyzer, apiKey, dict, settings, sharedText, speaker } from '../state';
import {
  applyFix,
  error,
  findToken,
  fixedWords,
  rateWait,
  rebuildAll,
  retry,
  selection,
  sentences,
  sourceLang,
  sourceText,
  translate,
  translating,
  view,
} from '../session';
import { upsertEntry } from '../lib/storage';
import { env } from './main/env';
import { useSpeakerState } from './main/useSpeakerState';
import { SourcePanel } from './main/SourcePanel';
import { TokenText } from './main/TokenText';
import { FixPanel } from './main/FixPanel';
import { Player } from './main/Player';
import { FixedList } from './main/FixedList';
import '../styles/main.css';

export function Main() {
  const key = apiKey.value;
  const list = sentences.value;
  const sel = selection.value;
  const selToken = sel ? findToken(sel.sentence, sel.tokenId) : null;
  const err = error.value;
  const wait = rateWait.value;
  const showAllRuby = settings.value.showAllRuby;
  const kana = view.value === 'kana';
  const speaking = useSpeakerState(speaker);
  const [copied, setCopied] = useState(false);

  // 辞書や解析器が変わったら全文を作り直す（画面に戻ったときも）
  const d = dict.value;
  const a = analyzer.value;
  useEffect(() => rebuildAll(env), [d, a]);

  const run = () => {
    const text = sourceText.value.trim();
    if (!key || text === '') return;
    void translate({ key, model: settings.value.model, text, sourceLang: sourceLang.value }, env);
  };

  // URL で渡された本文は原文に入れてすぐ訳す。key が無ければ、登録して戻ってきたときに訳す
  useEffect(() => {
    const t = sharedText.value;
    if (t === null || !key) return;
    sharedText.value = null;
    sourceText.value = t;
    run();
  }, [key]);

  const pick = (sentence: number, t: Token) => {
    selection.value = { sentence, tokenId: t.id };
  };

  const copy = async () => {
    await navigator.clipboard.writeText(list.map((s) => s.ja).join(''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main class="main-page">
      {!key && (
        <div role="alert" class="main-nokey">
          Groq の API key が未登録です。翻訳するには、先に
          <a href="#/setup">設定画面で key を登録</a>
          してください。
        </div>
      )}

      <SourcePanel onTranslate={run} canTranslate={!!key && sourceText.value.trim() !== ''} />

      <section aria-labelledby="out-h" class="card main-card main-out">
        <div class="main-head">
          <h2 id="out-h">訳文</h2>
          <div class="main-tools">
            <label class="main-check">
              <input
                type="checkbox"
                checked={showAllRuby}
                onChange={(e) => {
                  settings.value = { ...settings.value, showAllRuby: e.currentTarget.checked };
                }}
              />
              ふりがなをすべて表示
            </label>
            <div role="group" aria-label="表示の切り替え" class="main-tabs">
              <button type="button" aria-pressed={!kana} onClick={() => (view.value = 'display')}>
                表示用
              </button>
              <button type="button" aria-pressed={kana} onClick={() => (view.value = 'kana')}>
                読み上げ用
              </button>
            </div>
          </div>
        </div>

        <p class="main-sub">
          {kana
            ? '読み上げにはこの文を使います。かなにするのは直した語だけで、ほかは漢字のまま渡すので、イントネーションが崩れにくくなります。'
            : '読みが違う語は、クリックするとその場で直せます。語以外の所をクリックすると、その文から読み上げます。'}
        </p>

        {wait !== null && (
          <p role="status" class="main-wait">
            Groq の 1 分あたりの上限に達したので、約 {wait} 秒待ってから続きを訳します
          </p>
        )}

        {err && (
          <div role="alert" class="main-error">
            <span>{err.message}</span>
            {err.kind === 'auth' && <a href="#/setup">設定画面で key を確かめる</a>}
            {(err.kind === 'network' || err.kind === 'other' || (err.kind === 'rate' && err.scope === 'minute')) && (
              <button type="button" class="btn" onClick={() => void retry(env)}>
                再試行
              </button>
            )}
          </div>
        )}

        {list.length === 0 && !translating.value && !err ? (
          <p class="main-empty">原文を貼り付けて「翻訳する」を押すと、ここに訳文が 1 文ずつ出ます。</p>
        ) : (
          <TokenText
            sentences={list}
            view={view.value}
            showAllRuby={showAllRuby}
            speaking={speaking}
            selectedId={sel?.tokenId ?? null}
            receiving={translating.value}
            onPick={pick}
            onPlayFrom={(i) => speaker?.playFrom(i)}
          />
        )}

        <div class="main-legend">
          <span>
            <span aria-hidden="true" class="legend-ai" />
            AI が付けた読み
          </span>
          <span>
            <span aria-hidden="true" class="legend-fixed" />
            自分で直した読み
          </span>
          <span>
            <span aria-hidden="true" class="legend-auto" />
            クリックで読みを直せる語
          </span>
        </div>

        {sel && selToken && (
          <FixPanel
            token={selToken}
            onPreview={(r) => speaker?.preview(r)}
            onPlayFrom={() => {
              selection.value = null;
              speaker?.playFrom(sel.sentence);
            }}
            onCancel={() => (selection.value = null)}
            onSave={(reading, target) => applyFix({ sentence: sel.sentence, word: selToken.text, reading, target }, env)}
          />
        )}

        <Player speaker={speaker} state={speaking} total={list.length} translating={translating.value} />

        <div class="main-actions">
          <button type="button" class="btn" disabled={list.length === 0} onClick={() => void copy()}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h8" />
            </svg>
            {copied ? 'コピーしました' : '訳文をコピー'}
          </button>
          <button type="button" class="btn" disabled={!speaker || list.length === 0} onClick={() => speaker?.playFrom(0)}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            最初から読む
          </button>
        </div>
      </section>

      <FixedList
        items={fixedWords(list)}
        onEdit={(w) => (selection.value = { sentence: w.sentence, tokenId: w.tokenId })}
        onToDict={(w) => {
          // 読みは変わらないので読み直さない。全文の作り直しは上の effect に任せる
          dict.value = upsertEntry(dict.value, { word: w.word, reading: w.reading, source: 'translation' });
        }}
      />
    </main>
  );
}
