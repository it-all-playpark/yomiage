import { describe, expect, it, vi } from 'vitest';
import type { Sentence } from '../types';
import {
  DEFAULT_MODEL,
  MODELS,
  buildMessages,
  isGroqError,
  splitParagraphs,
  testConnection,
  toGroqError,
  translateStream,
} from './groq';

const enc = new TextEncoder();

/** content の断片を SSE の data 行にする */
function sse(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** バイト列を任意の位置で区切って流すストリーム */
function streamOf(text: string, cuts: number[] = []): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  const pieces: Uint8Array[] = [];
  let prev = 0;
  for (const c of [...cuts, bytes.length]) {
    pieces.push(bytes.slice(prev, c));
    prev = c;
  }
  return new ReadableStream({
    start(ctrl) {
      for (const p of pieces) ctrl.enqueue(p);
      ctrl.close();
    },
  });
}

function sseResponse(body: string, cuts?: number[]): Response {
  return new Response(streamOf(body, cuts), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function line(i: number, ja: string, readings: { w: string; r: string }[] = []): string {
  return JSON.stringify({ i, ja, readings }) + '\n';
}

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** 呼ばれた順に responses を返す fetch */
function fakeFetch(responses: (Response | Error | DOMException)[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const r = responses.shift();
    if (!r) throw new Error('予定外の呼び出し');
    if (!(r instanceof Response)) throw r; // DOMException は jsdom では Error を継がない
    return r;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

async function run(fetchImpl: typeof fetch, text = 'Hello.', model = DEFAULT_MODEL, signal?: AbortSignal) {
  const got: Sentence[] = [];
  const result = await translateStream({
    key: 'gsk_test',
    model,
    text,
    sourceLang: 'auto',
    dict: [],
    signal,
    onSentence: (s) => got.push(s),
    fetchImpl,
  });
  return { got, result };
}

describe('MODELS', () => {
  it('速さ重視が既定でおすすめ、gpt-oss は reasoning_effort low', () => {
    expect(DEFAULT_MODEL).toBe('llama-3.3-70b-versatile');
    expect(MODELS.find((m) => m.recommended)?.id).toBe(DEFAULT_MODEL);
    expect(MODELS.find((m) => m.id === 'openai/gpt-oss-120b')?.extra).toEqual({ reasoning_effort: 'low' });
  });
});

describe('splitParagraphs', () => {
  it('空行で分け、前後の空白と空の段落を落とす', () => {
    expect(splitParagraphs('  First line.\nsame para.\r\n\r\n\n Second. \n \nThird.\n\n')).toEqual([
      'First line.\nsame para.',
      'Second.',
      'Third.',
    ]);
  });

  it('空文字は段落なし', () => {
    expect(splitParagraphs(' \n\n ')).toEqual([]);
  });
});

describe('buildMessages', () => {
  it('system に形式・開始番号・言語・辞書の読みを入れ、user は段落そのまま', () => {
    const m = buildMessages('Xi met the PM.', {
      sourceLang: 'en',
      dictHints: [{ word: '習近平', reading: 'しゅうきんぺい' }],
      startIndex: 5,
    });
    expect(m).toHaveLength(2);
    expect(m[0].role).toBe('system');
    expect(m[0].content).toContain('"readings"');
    expect(m[0].content).toContain('5 から');
    expect(m[0].content).toContain('原文の言語: en');
    expect(m[0].content).toContain('習近平=しゅうきんぺい');
    expect(m[1]).toEqual({ role: 'user', content: 'Xi met the PM.' });
  });

  it('auto なら自動判定、辞書が空なら読みの指定を入れない', () => {
    const m = buildMessages('a', { sourceLang: 'auto', dictHints: [], startIndex: 0 });
    expect(m[0].content).toContain('自動で判定');
    expect(m[0].content).not.toContain('必ずこの読み');
  });
});

describe('translateStream', () => {
  it('分割チャンク（行の途中・文字の途中で切れる）から 1 文ずつ受け取る', async () => {
    const content = line(0, '中国の習近平国家主席は会談した。', [{ w: '習近平', r: 'しゅうきんぺい' }]) + line(1, '一方、議論を再開した。');
    // content を細かく刻んで SSE にし、さらにバイト単位で半端な位置で切る
    const deltas = [content.slice(0, 10), content.slice(10, 40), content.slice(40, 70), content.slice(70)];
    const body = deltas.map(sse).join('') + 'data: [DONE]\n\n';
    const len = enc.encode(body).length;
    const cuts = [7, 50, 51, 52, 120, Math.floor(len / 2), len - 3];
    const { impl, calls } = fakeFetch([sseResponse(body, cuts)]);

    const { got } = await run(impl);

    expect(got).toEqual([
      { i: 0, ja: '中国の習近平国家主席は会談した。', readings: [{ w: '習近平', r: 'しゅうきんぺい' }] },
      { i: 1, ja: '一方、議論を再開した。', readings: [] },
    ]);
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    expect(calls[0].body).toMatchObject({ model: DEFAULT_MODEL, stream: true });
    expect(calls[0].body).not.toHaveProperty('reasoning_effort');
  });

  it('最後の行が改行で終わらなくても受け取る', async () => {
    const body = sse('{"i":0,"ja":"終わり。","readings":[]}') + 'data: [DONE]\n\n';
    const { got } = await run(fakeFetch([sseResponse(body)]).impl);
    expect(got.map((s) => s.ja)).toEqual(['終わり。']);
  });

  it('段落ごとに順に送り、文番号は全段落通しで 0 から振る', async () => {
    // モデルは段落ごとに 0 から数えてしまっても、通し番号にする
    const p1 = sse(line(0, '一。') + line(1, '二。')) + 'data: [DONE]\n\n';
    const p2 = sse(line(0, '三。')) + 'data: [DONE]\n\n';
    const { impl, calls } = fakeFetch([sseResponse(p1), sseResponse(p2)]);

    const { got } = await run(impl, 'One. Two.\n\nThree.');

    expect(got.map((s) => [s.i, s.ja])).toEqual([
      [0, '一。'],
      [1, '二。'],
      [2, '三。'],
    ]);
    expect(calls).toHaveLength(2);
    const user = (c: Call) => (c.body.messages as { role: string; content: string }[])[1].content;
    expect(user(calls[0])).toBe('One. Two.');
    expect(user(calls[1])).toBe('Three.');
    // 2 段落目は 2 番から始めるよう指示する
    expect((calls[1].body.messages as { content: string }[])[0].content).toContain('2 から');
  });

  it('gpt-oss では reasoning_effort: low を付けて送る', async () => {
    const { impl, calls } = fakeFetch([sseResponse(sse(line(0, 'あ。')) + 'data: [DONE]\n\n')]);
    await run(impl, 'a', 'openai/gpt-oss-120b');
    expect(calls[0].body).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low' });
  });

  it('壊れた行はその文だけ再要求し、順番どおりに渡す', async () => {
    const body = sse(line(0, '一。') + '{"i":1,"ja":"二\n' + line(2, '三。')) + 'data: [DONE]\n\n';
    const retry = Response.json({ choices: [{ message: { content: line(1, '二。') } }] });
    const { impl, calls } = fakeFetch([sseResponse(body), retry]);

    const { got } = await run(impl);

    expect(got.map((s) => [s.i, s.ja])).toEqual([
      [0, '一。'],
      [1, '二。'],
      [2, '三。'],
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1].body.stream).toBe(false);
    const retryUser = (calls[1].body.messages as { content: string }[])[1].content;
    expect(retryUser).toContain('{"i":1,"ja":"二');
    expect(retryUser).toContain('Hello.');
  });

  it('再要求でも壊れていればその文は捨て、番号を詰める', async () => {
    const body = sse('{"i":0,"ja":\n' + line(1, '二。')) + 'data: [DONE]\n\n';
    const retry = Response.json({ choices: [{ message: { content: 'やっぱり壊れた' } }] });
    const { impl, calls } = fakeFetch([sseResponse(body), retry]);
    const { got } = await run(impl);
    expect(calls).toHaveLength(2);
    expect(got.map((s) => [s.i, s.ja])).toEqual([[0, '二。']]);
  });

  it('JSON でない前置き・後書きは文ではないので再要求せずに飛ばす', async () => {
    const body = sse('以下が翻訳です：\n' + line(0, '一。') + '以上です。') + 'data: [DONE]\n\n';
    const { impl, calls } = fakeFetch([sseResponse(body)]);
    const { got } = await run(impl);
    expect(calls).toHaveLength(1);
    expect(got.map((s) => [s.i, s.ja])).toEqual([[0, '一。']]);
  });

  it('usage を返す', async () => {
    const body = sse(line(0, 'あ。')) + `data: ${JSON.stringify({ choices: [{ delta: {} }], x_groq: { usage: { total_tokens: 42 } } })}\n\n` + 'data: [DONE]\n\n';
    const { result } = await run(fakeFetch([sseResponse(body)]).impl);
    expect(result.usage).toEqual([{ total_tokens: 42 }]);
  });

  it('401 は auth の GroqError', async () => {
    const { impl } = fakeFetch([new Response('{}', { status: 401 })]);
    await expect(run(impl)).rejects.toEqual({ kind: 'auth', message: 'key が使えません' });
  });

  it('429 は retry-after の秒数を持つ rate の GroqError', async () => {
    const { impl } = fakeFetch([new Response('{}', { status: 429, headers: { 'retry-after': '17' } })]);
    const err = await run(impl).catch((e) => e);
    expect(isGroqError(err)).toBe(true);
    expect(err).toMatchObject({ kind: 'rate', retryAfterSec: 17 });
    expect(err.message).toContain('Groq の無料枠の上限に達しました');
    expect(err.message).toContain('17 秒');
  });

  it('通信エラーは network の GroqError', async () => {
    const { impl } = fakeFetch([new TypeError('Failed to fetch')]);
    await expect(run(impl)).rejects.toEqual({ kind: 'network', message: 'Groq に接続できません' });
  });

  it('受信の途中で切れたら network の GroqError', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(enc.encode(sse(line(0, '一。'))));
      },
      // 1 チャンク読んだ後に切れる
      pull(ctrl) {
        ctrl.error(new TypeError('network error'));
      },
    });
    const got: Sentence[] = [];
    const err = await translateStream({
      key: 'k',
      model: DEFAULT_MODEL,
      text: 'a',
      sourceLang: 'auto',
      dict: [],
      onSentence: (s) => got.push(s),
      fetchImpl: fakeFetch([new Response(body)]).impl,
    }).catch((e) => e);
    expect(err).toMatchObject({ kind: 'network' });
    expect(got.map((s) => s.ja)).toEqual(['一。']);
  });

  it('中断は GroqError にせず AbortError のまま投げる', async () => {
    const ac = new AbortController();
    ac.abort();
    const { impl } = fakeFetch([new DOMException('aborted', 'AbortError')]);
    const err = await run(impl, 'a', DEFAULT_MODEL, ac.signal).catch((e) => e);
    expect(isGroqError(err)).toBe(false);
    expect((err as DOMException).name).toBe('AbortError');
  });
});

describe('toGroqError', () => {
  it('§3.6 の文言', () => {
    expect(toGroqError(401)).toEqual({ kind: 'auth', message: 'key が使えません' });
    expect(toGroqError(429)).toEqual({
      kind: 'rate',
      message: 'Groq の無料枠の上限に達しました。しばらく待ってから再実行してください',
    });
    expect(toGroqError('network')).toEqual({ kind: 'network', message: 'Groq に接続できません' });
    expect(toGroqError(500)).toMatchObject({ kind: 'other' });
  });
});

describe('testConnection', () => {
  it('成功なら使えるモデルの一覧を返す', async () => {
    const { impl, calls } = fakeFetch([Response.json({ data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }] })]);
    expect(await testConnection('gsk_x', impl)).toEqual({ ok: true, models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'] });
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/models');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_x');
  });

  it('401 と通信エラーは ok: false', async () => {
    expect(await testConnection('bad', fakeFetch([new Response('', { status: 401 })]).impl)).toEqual({
      ok: false,
      error: { kind: 'auth', message: 'key が使えません' },
    });
    expect(await testConnection('k', fakeFetch([new TypeError('x')]).impl)).toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});
