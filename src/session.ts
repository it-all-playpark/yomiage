// 翻訳セッションの状態（FR-2〜4）。文・トークン・この文だけの修正・選択中の語を持つ。
// 画面を移っても残るようにモジュールの signal に置く。「この文だけ」の修正は保存しない（§7）
import { signal } from '@preact/signals';
import type { AiReading, DictData, Fix, GroqError, SpeechText, Token } from './types';
import type { Analyzer } from './lib/analyzer';
import type { Speaker } from './lib/speech';
import { isGroqError, translateStream } from './lib/groq';
import { tokenizeSentence } from './lib/tokenize';
import { buildSpeechText } from './lib/speechText';
import { upsertEntry } from './lib/storage';

export interface SessionSentence {
  i: number;
  ja: string;
  ai: AiReading[];
  once: Map<string, string>; // この文だけの修正（語 → 読み）
  tokens: Token[];
  speech: SpeechText;
}

/** セッションが外から借りるもの。Main が state.ts から組み立てる */
export interface SessionEnv {
  speaker: Speaker | null;
  dict(): DictData;
  setDict(d: DictData): void;
  analyzer(): Analyzer | null;
  fetchImpl?: typeof fetch;
}

export interface TranslateRequest {
  key: string;
  model: string;
  text: string;
  sourceLang: string | 'auto';
}

export type View = 'display' | 'kana';

export const sourceText = signal('');
export const sourceLang = signal<string>('auto');
export const sentences = signal<SessionSentence[]>([]);
export const translating = signal(false);
export const error = signal<GroqError | null>(null);
export const selection = signal<{ sentence: number; tokenId: number } | null>(null);
export const view = signal<View>('display');

let controller: AbortController | null = null;
let lastRequest: TranslateRequest | null = null;

// トークン id は文ごとに区切って振る（文をまたいで重ならない）
const ID_STRIDE = 10000;

function dictMap(d: DictData): Map<string, string> {
  return new Map(d.entries.map((e) => [e.word, e.reading]));
}

function build(i: number, ja: string, ai: AiReading[], once: Map<string, string>, env: SessionEnv): SessionSentence {
  const tokens = tokenizeSentence({
    sentence: i,
    text: ja,
    ai,
    dict: dictMap(env.dict()),
    once,
    analyzer: env.analyzer(),
    startId: i * ID_STRIDE,
  });
  return { i, ja, ai, once, tokens, speech: buildSpeechText(tokens) };
}

function replace(s: SessionSentence): void {
  sentences.value = sentences.value.map((x) => (x.i === s.i ? s : x));
}

/** 翻訳を始める。翻訳中なら前回を止める */
export async function translate(req: TranslateRequest, env: SessionEnv): Promise<void> {
  const t0 = performance.now(); // NFR-1 / V4：押してから最初の speak まで
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  lastRequest = req;

  env.speaker?.stop();
  sentences.value = [];
  selection.value = null;
  error.value = null;
  translating.value = true;

  try {
    const r = await translateStream({
      key: req.key,
      model: req.model,
      text: req.text,
      sourceLang: req.sourceLang,
      // 辞書は全件送らず、原文に出てくる語だけを読みのヒントにする（§3.4）。訳文には tokenize で辞書が必ず効く
      dict: env
        .dict()
        .entries.filter((e) => req.text.includes(e.word))
        .map((e) => ({ word: e.word, reading: e.reading })),
      signal: ctrl.signal,
      fetchImpl: env.fetchImpl,
      onSentence: (s) => {
        if (ctrl !== controller) return;
        const ss = build(s.i, s.ja, s.readings, new Map(), env);
        sentences.value = [...sentences.value, ss];
        env.speaker?.setSentence(ss.i, ss.speech);
        // 1 文目が届いたら読み始める（FR-3.1）
        if (ss.i === 0 && env.speaker) {
          env.speaker.play();
          console.info(`[V4] 翻訳する → 最初の speak: ${Math.round(performance.now() - t0)} ms`);
        }
      },
    });
    if (ctrl === controller) console.info('[V3] usage', r.usage);
  } catch (e) {
    if (ctrl !== controller) return;
    if (isGroqError(e)) error.value = e;
    else if ((e as { name?: unknown })?.name !== 'AbortError') throw e;
  } finally {
    if (ctrl === controller) {
      translating.value = false;
      controller = null;
    }
  }
}

/** 直前の翻訳をやり直す（通信エラーの再試行） */
export function retry(env: SessionEnv): Promise<void> {
  return lastRequest ? translate(lastRequest, env) : Promise.resolve();
}

/** 辞書や解析器が変わったとき、全文のトークンと発話を作り直す */
export function rebuildAll(env: SessionEnv): void {
  const sel = selection.value;
  const old = sel ? findToken(sel.sentence, sel.tokenId) : null;
  const next = sentences.value.map((s) => build(s.i, s.ja, s.ai, s.once, env));
  sentences.value = next;
  for (const s of next) env.speaker?.setSentence(s.i, s.speech);
  // 作り直すと id が振り直されるので、選択は同じ位置・同じ文字列の語に付け替える。分け方が変わって無くなれば閉じる
  if (sel) {
    const t = old && next.find((s) => s.i === sel.sentence)?.tokens.find((x) => x.start === old.start && x.text === old.text);
    selection.value = t ? { sentence: sel.sentence, tokenId: t.id } : null;
  }
}

export function findToken(sentence: number, tokenId: number): Token | null {
  return sentences.value.find((s) => s.i === sentence)?.tokens.find((t) => t.id === tokenId) ?? null;
}

/** 読みを直す。保存後はその文（辞書なら全文）を作り直し、読み上げ中ならその文から読み直す（§6） */
export function applyFix(
  opts: { sentence: number; word: string; reading: string; target: 'once' | 'dict' },
  env: SessionEnv,
): void {
  if (opts.target === 'once') {
    const s = sentences.value.find((x) => x.i === opts.sentence);
    if (!s) return;
    const once = new Map(s.once).set(opts.word, opts.reading);
    const ns = build(s.i, s.ja, s.ai, once, env);
    replace(ns);
    env.speaker?.setSentence(ns.i, ns.speech);
  } else {
    env.setDict(upsertEntry(env.dict(), { word: opts.word, reading: opts.reading, source: 'translation' }));
    rebuildAll(env);
  }
  selection.value = null;
  env.speaker?.respeakFrom(opts.sentence);
}

export interface FixedWord {
  word: string;
  reading: string;
  fix: Exclude<Fix, 'none'>;
  sentence: number;
  tokenId: number;
}

/** 「直した読み」一覧：AI と自分が直した語を、最初に出た所で 1 件ずつ */
export function fixedWords(list: SessionSentence[]): FixedWord[] {
  const seen = new Set<string>();
  const out: FixedWord[] = [];
  for (const s of list) {
    for (const t of s.tokens) {
      if (t.fix === 'none' || t.reading === null || seen.has(t.text)) continue;
      seen.add(t.text);
      out.push({ word: t.text, reading: t.reading, fix: t.fix, sentence: s.i, tokenId: t.id });
    }
  }
  return out;
}

/** テスト用：状態を初期に戻す */
export function resetSession(): void {
  controller?.abort();
  controller = null;
  lastRequest = null;
  sourceText.value = '';
  sourceLang.value = 'auto';
  sentences.value = [];
  translating.value = false;
  error.value = null;
  selection.value = null;
  view.value = 'display';
}
