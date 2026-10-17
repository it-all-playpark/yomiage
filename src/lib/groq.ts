// Groq（OpenAI 互換 Chat Completions）とのやり取り（spec §3）
import type { GroqError, SavedSentence, Sentence } from '../types';
import { LineBuffer, parseSentenceLine, parseSseData } from './ndjson';
import { chunkKey, loadChunk, saveChunk } from './storage';

const API = 'https://api.groq.com/openai/v1';

export const MODELS: { id: string; label: string; recommended: boolean; extra?: Record<string, unknown> }[] = [
  { id: 'openai/gpt-oss-20b', label: '速さ重視', recommended: true, extra: { reasoning_effort: 'low' } },
  { id: 'openai/gpt-oss-120b', label: '精度重視', recommended: false, extra: { reasoning_effort: 'low' } },
];

export const DEFAULT_MODEL = 'openai/gpt-oss-20b';

type Message = { role: 'system' | 'user'; content: string };
type DictHint = { word: string; reading: string };

/** 空行で段落に分ける（§3.5） */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t　]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/** 1 回の要求に入れる原文の目安（文字数） */
export const CHUNK_CHARS = 2000;

/**
 * 段落を、合計が max 文字までの塊にまとめる（§3.5）。要求ごとにシステムプロンプトを送り直すので、
 * 段落ごとに送るより要求数もトークンも減る。max を超える段落は 1 つで 1 塊にする。塊は段落の配列で返す
 */
export function chunkParagraphs(text: string, max = CHUNK_CHARS): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const p of splitParagraphs(text)) {
    if (cur.length > 0 && len + 2 + p.length > max) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    len += (cur.length > 0 ? 2 : 0) + p.length;
    cur.push(p);
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

function systemPrompt(opts: { sourceLang: string | 'auto'; dictHints: DictHint[]; startIndex: number }): string {
  const lines = [
    'あなたは翻訳者です。入力を自然な日本語に訳し、1 文ごとに次の JSON を 1 行で出力してください。',
    '{"i": 文番号, "p": 段落番号, "ja": 訳文, "readings": [{"w": 語, "r": ひらがなの読み}]}',
    `文番号は ${opts.startIndex} から始めてください。`,
    '入力は空行で段落に分かれています。段落番号は、その文が入力の何番目の段落にあるかを 0 から数えた数です。',
    'readings には、音声合成が読み間違えそうな語（固有名詞、難読語、読みを取り違えやすい熟語）だけを入れてください。読みはひらがなで書いてください。',
    'JSON 以外の文字は出力しないでください。',
    opts.sourceLang === 'auto' ? '原文の言語は自動で判定してください。' : `原文の言語: ${opts.sourceLang}`,
  ];
  if (opts.dictHints.length > 0) {
    lines.push(`次の語は必ずこの読みを使ってください: ${opts.dictHints.map((h) => `${h.word}=${h.reading}`).join('、')}`);
  }
  return lines.join('\n');
}

export function buildMessages(
  paragraph: string,
  opts: { sourceLang: string | 'auto'; dictHints: DictHint[]; startIndex: number },
): Message[] {
  return [
    { role: 'system', content: systemPrompt(opts) },
    { role: 'user', content: paragraph },
  ];
}

/** retry-after は秒数で来る（数値でなければ無視） */
function retryAfter(headers?: Headers): number | undefined {
  const v = headers?.get('retry-after');
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

/**
 * 429 がどの枠に当たったか（§3.6）。x-ratelimit-*-requests は 1 日の要求数、x-ratelimit-*-tokens は 1 分のトークン数。
 * どちらも残っていれば（1 分の要求数か 1 日のトークン数）、待ち時間の長さで分ける
 */
function rateScope(headers: Headers | undefined, sec: number | undefined): 'minute' | 'day' | undefined {
  if (headers?.get('x-ratelimit-remaining-requests') === '0') return 'day';
  if (headers?.get('x-ratelimit-remaining-tokens') === '0') return 'minute';
  if (sec === undefined) return undefined;
  return sec <= 60 ? 'minute' : 'day';
}

function duration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min} 分`;
  return min % 60 === 0 ? `${min / 60} 時間` : `${Math.floor(min / 60)} 時間 ${min % 60} 分`;
}

/** HTTP の状態から画面に出すエラーを作る（§3.6） */
export function toGroqError(status: number | 'network', headers?: Headers): GroqError {
  if (status === 'network') return { kind: 'network', message: 'Groq に接続できません' };
  if (status === 401) return { kind: 'auth', message: 'key が使えません' };
  if (status === 429) {
    const sec = retryAfter(headers);
    const scope = rateScope(headers, sec);
    const base =
      scope === 'minute'
        ? 'Groq の 1 分あたりの上限に達しました。少し待ってから再実行してください'
        : scope === 'day'
          ? 'Groq の無料枠の 1 日の上限に達しました。時間をおいて再実行してください'
          : 'Groq の無料枠の上限に達しました。しばらく待ってから再実行してください';
    return {
      kind: 'rate',
      message: sec === undefined ? base : `${base}（約 ${duration(sec)}後に再実行できます）`,
      ...(sec === undefined ? {} : { retryAfterSec: sec }),
      ...(scope === undefined ? {} : { scope }),
    };
  }
  return { kind: 'other', message: `Groq でエラーが発生しました（HTTP ${status}）` };
}

export function isGroqError(e: unknown): e is GroqError {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return ['auth', 'rate', 'network', 'other'].includes(o.kind as string) && typeof o.message === 'string';
}

function isAbort(e: unknown): boolean {
  // jsdom と Node で DOMException が別物なので name で見る
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/** fetch して、失敗は GroqError にする。中断（AbortError）はそのまま投げる */
async function request(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw toGroqError('network');
  }
  if (!res.ok) throw toGroqError(res.status, res.headers);
  return res;
}

/** 1 つの要求で 1 分の枠を待ち直す回数の上限 */
const MAX_RATE_WAITS = 3;

/** 中断できる待ち。中断されたら AbortError を投げる */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

function modelExtra(model: string): Record<string, unknown> {
  return MODELS.find((m) => m.id === model)?.extra ?? {};
}

export async function translateStream(opts: {
  key: string;
  model: string;
  text: string;
  sourceLang: string | 'auto';
  dict: DictHint[];
  signal?: AbortSignal;
  onSentence: (s: Sentence, paragraph: number) => void; // paragraph は原文の段落番号（0 から）
  /** 1 分の枠に当たって待つ間は秒数、待ち終えたら null */
  onWait?: (sec: number | null) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ usage?: unknown }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opts.key}`, 'Content-Type': 'application/json' };
  // 1 分の枠に当たったら retry-after だけ待って同じ要求を送り直す（§3.6）。1 日の枠や待ち時間が分からないときは投げる
  const post = async (messages: Message[], stream: boolean): Promise<Response> => {
    for (let waits = 0; ; waits++) {
      try {
        return await request(fetchImpl, `${API}/chat/completions`, {
          method: 'POST',
          headers,
          signal: opts.signal,
          body: JSON.stringify({ model: opts.model, messages, stream, ...modelExtra(opts.model) }),
        });
      } catch (e) {
        if (!isGroqError(e) || e.scope !== 'minute' || e.retryAfterSec === undefined || waits >= MAX_RATE_WAITS) throw e;
        opts.onWait?.(e.retryAfterSec);
        try {
          await sleep(e.retryAfterSec * 1000, opts.signal);
        } finally {
          opts.onWait?.(null);
        }
      }
    }
  };

  const usages: unknown[] = [];
  let next = 0; // 全塊通しの文番号
  let base = 0; // いまの塊の先頭の段落番号
  let count = 1; // いまの塊の段落の数
  let local = 0; // 直前の文の、塊の中での段落番号
  let saved: SavedSentence[] = []; // いまの塊で渡した文（最後まで受け取れたら保存する）
  let complete = true; // いまの塊を欠けなく受け取れたか（[DONE] を受け取り、再要求が通信エラーで落ちていない）

  // パースできた文に通し番号を振って渡す（モデルの i は使わない）。段落番号はモデルの p を使うが、
  // 無いとき・戻るとき・塊の外を指すときは直前の文と同じ段落にする
  const emit = (s: Sentence) => {
    if (s.p !== undefined && s.p >= local && s.p < count) local = s.p;
    const { p: _, ...rest } = s;
    saved.push({ p: local, ja: s.ja, readings: s.readings });
    opts.onSentence({ ...rest, i: next++ }, base + local);
  };

  // 壊れた行の文だけを、非ストリーミングで 1 回だけ再要求する（§3.3）
  const retryLine = async (paragraph: string, broken: string): Promise<Sentence | null> => {
    const messages: Message[] = [
      { role: 'system', content: systemPrompt({ sourceLang: opts.sourceLang, dictHints: opts.dict, startIndex: next }) },
      {
        role: 'user',
        content: `次の原文を訳した出力のうち、1 行が JSON として壊れていました。その 1 文だけを正しい形式の JSON 1 行で出力し直してください。\n原文:\n${paragraph}\n壊れた行:\n${broken}`,
      },
    ];
    let body;
    try {
      const res = await post(messages, false);
      body = await res.json();
    } catch (e) {
      // 中断は止める。429・通信エラー・JSON として読めない本文なら、その文だけ捨てて続ける
      if (isAbort(e)) throw e;
      // 一時的な失敗で欠けた塊を保存すると以後ずっと欠けたまま使うので、この塊は保存しない
      complete = false;
      return null;
    }
    if (body?.usage) usages.push(body.usage);
    const content: unknown = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    for (const l of content.split('\n')) {
      const s = parseSentenceLine(l);
      if (s) return s;
    }
    return null;
  };

  const handleLine = async (paragraph: string, line: string) => {
    const t = line.trim();
    // JSON の行だけが文。空行・コードフェンス・前置きや後書きは再要求せずに飛ばす
    if (!t.startsWith('{')) return;
    const s = parseSentenceLine(t) ?? (await retryLine(paragraph, t));
    // 再要求でも駄目ならその文は捨てる
    if (s) emit(s);
  };

  for (const chunk of chunkParagraphs(opts.text)) {
    count = chunk.length;
    local = 0;
    const paragraph = chunk.join('\n\n');
    // 訳し終えた塊は送らず、保存した文を通し番号を振り直して渡す（§3.5）
    const key = chunkKey(opts.model, opts.sourceLang, paragraph);
    const cached = loadChunk(key);
    if (cached) {
      for (const s of cached) opts.onSentence({ i: next++, ja: s.ja, readings: s.readings }, base + s.p);
      base += count;
      continue;
    }
    saved = [];
    complete = true;
    const messages = buildMessages(paragraph, { sourceLang: opts.sourceLang, dictHints: opts.dict, startIndex: next });
    const res = await post(messages, true);
    if (!res.body) throw toGroqError('network');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sse = new LineBuffer();
    const content = new LineBuffer();
    let done = false;
    let gotDone = false;
    while (!done) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (isAbort(e)) throw e;
        throw toGroqError('network');
      }
      const sseLines = chunk.done ? [...sse.push(decoder.decode()), ...sse.flush()] : sse.push(decoder.decode(chunk.value, { stream: true }));
      for (const sseLine of sseLines) {
        const usage = usageOf(sseLine);
        if (usage) usages.push(usage);
        const delta = parseSseData(sseLine);
        if (delta === 'DONE') {
          done = true;
          gotDone = true;
          break;
        }
        if (delta === null) continue;
        for (const l of content.push(delta)) await handleLine(paragraph, l);
      }
      if (chunk.done) done = true;
    }
    await reader.cancel().catch(() => {});
    // 最後の文が改行で終わらなかった場合
    for (const l of content.flush()) await handleLine(paragraph, l);
    // 最後まで受け取れた塊だけ保存する。中断・通信エラーなら上で投げているので保存しない。
    // [DONE] を受け取らずに閉じた塊・再要求が通信エラーや 429 で落ちた塊も保存しない。1 文も無ければ次も要求する
    if (!gotDone) complete = false;
    if (complete && saved.length > 0) saveChunk(key, saved);
    base += count;
  }

  return usages.length > 0 ? { usage: usages } : {};
}

/** Groq は最後のチャンクの x_groq.usage（または usage）に使用量を入れる（V3 の記録用） */
function usageOf(line: string): unknown {
  if (!line.startsWith('data:')) return undefined;
  const data = line.slice(5).trim();
  if (!data.startsWith('{')) return undefined;
  try {
    const o = JSON.parse(data);
    return o?.x_groq?.usage ?? o?.usage ?? undefined;
  } catch {
    return undefined;
  }
}

export async function testConnection(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; models: string[] } | { ok: false; error: GroqError }> {
  try {
    const res = await request(fetchImpl, `${API}/models`, { headers: { Authorization: `Bearer ${key}` } });
    const body = await res.json();
    const models = Array.isArray(body?.data) ? body.data.map((m: { id: unknown }) => m.id).filter((id: unknown) => typeof id === 'string') : [];
    return { ok: true, models };
  } catch (e) {
    if (isGroqError(e)) return { ok: false, error: e };
    return { ok: false, error: toGroqError('network') };
  }
}
