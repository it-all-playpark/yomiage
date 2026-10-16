// Groq（OpenAI 互換 Chat Completions）とのやり取り（spec §3）
import type { GroqError, Sentence } from '../types';
import { LineBuffer, parseSentenceLine, parseSseData } from './ndjson';

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

function systemPrompt(opts: { sourceLang: string | 'auto'; dictHints: DictHint[]; startIndex: number }): string {
  const lines = [
    'あなたは翻訳者です。入力を自然な日本語に訳し、1 文ごとに次の JSON を 1 行で出力してください。',
    '{"i": 文番号, "ja": 訳文, "readings": [{"w": 語, "r": ひらがなの読み}]}',
    `文番号は ${opts.startIndex} から始めてください。`,
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

/** HTTP の状態から画面に出すエラーを作る（§3.6） */
export function toGroqError(status: number | 'network', headers?: Headers): GroqError {
  if (status === 'network') return { kind: 'network', message: 'Groq に接続できません' };
  if (status === 401) return { kind: 'auth', message: 'key が使えません' };
  if (status === 429) {
    const sec = retryAfter(headers);
    const base = 'Groq の無料枠の上限に達しました。しばらく待ってから再実行してください';
    return sec === undefined
      ? { kind: 'rate', message: base }
      : { kind: 'rate', message: `${base}（約 ${sec} 秒後に再実行できます）`, retryAfterSec: sec };
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
  onSentence: (s: Sentence) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ usage?: unknown }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opts.key}`, 'Content-Type': 'application/json' };
  const post = (messages: Message[], stream: boolean) =>
    request(fetchImpl, `${API}/chat/completions`, {
      method: 'POST',
      headers,
      signal: opts.signal,
      body: JSON.stringify({ model: opts.model, messages, stream, ...modelExtra(opts.model) }),
    });

  const usages: unknown[] = [];
  let next = 0; // 全段落通しの文番号

  // パースできた文に通し番号を振って渡す（モデルの i は使わない）
  const emit = (s: Sentence) => opts.onSentence({ ...s, i: next++ });

  // 壊れた行の文だけを、非ストリーミングで 1 回だけ再要求する（§3.3）
  const retryLine = async (paragraph: string, broken: string): Promise<Sentence | null> => {
    const messages: Message[] = [
      { role: 'system', content: systemPrompt({ sourceLang: opts.sourceLang, dictHints: opts.dict, startIndex: next }) },
      {
        role: 'user',
        content: `次の原文を訳した出力のうち、1 行が JSON として壊れていました。その 1 文だけを正しい形式の JSON 1 行で出力し直してください。\n原文:\n${paragraph}\n壊れた行:\n${broken}`,
      },
    ];
    const res = await post(messages, false);
    const body = await res.json();
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

  for (const paragraph of splitParagraphs(opts.text)) {
    const messages = buildMessages(paragraph, { sourceLang: opts.sourceLang, dictHints: opts.dict, startIndex: next });
    const res = await post(messages, true);
    if (!res.body) throw toGroqError('network');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sse = new LineBuffer();
    const content = new LineBuffer();
    let done = false;
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
