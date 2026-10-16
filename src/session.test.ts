import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictData } from './types';
import type { Speaker } from './lib/speech';
import type { Analyzer } from './lib/analyzer';
import {
  applyFix,
  error,
  fixedWords,
  rebuildAll,
  resetSession,
  retry,
  selection,
  sentences,
  translate,
  translating,
  type SessionEnv,
} from './session';

const enc = new TextEncoder();

/** NDJSON の各行を 1 つずつ SSE の data にして返す Response */
function sseResponse(lines: object[]): Response {
  const body = lines.map((l) => `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(l) + '\n' } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(body));
        c.close();
      },
    }),
    { status: 200 },
  );
}

function fakeSpeaker() {
  return {
    stop: vi.fn(),
    play: vi.fn(),
    setSentence: vi.fn(),
    respeakFrom: vi.fn(),
  };
}

function makeEnv(fetchImpl: typeof fetch, opts: { dict?: DictData; analyzer?: Analyzer | null } = {}) {
  let d: DictData = opts.dict ?? { version: 1, entries: [] };
  let a = opts.analyzer ?? null;
  const sp = fakeSpeaker();
  const env: SessionEnv = {
    speaker: sp as unknown as Speaker,
    dict: () => d,
    setDict: vi.fn((nd: DictData) => {
      d = nd;
    }),
    analyzer: () => a,
    fetchImpl,
  };
  return { env, sp, setAnalyzer: (x: Analyzer) => (a = x) };
}

const REQ = { key: 'gsk_x', model: 'openai/gpt-oss-20b', text: 'Xi met the PM.\n\nXi spoke.', sourceLang: 'auto' };

const S0 = { i: 0, ja: '習近平は会談した。', readings: [{ w: '習近平', r: 'しゅうきんぺい' }] };
const S1 = { i: 0, ja: '習近平が話した。', readings: [] };

beforeEach(() => {
  resetSession();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('translate', () => {
  it('届いた文をトークン化して積み、1 文目で再生を始める', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([S0])).mockResolvedValueOnce(sseResponse([S0])).mockResolvedValueOnce(sseResponse([S1]));
    const { env, sp } = makeEnv(fetchImpl as unknown as typeof fetch);
    await translate(REQ, env);

    expect(sentences.value.map((s) => s.i)).toEqual([0, 1]);
    const t = sentences.value[0].tokens.find((x) => x.text === '習近平');
    expect(t).toMatchObject({ fix: 'ai', reading: 'しゅうきんぺい' });
    // 2 文目は段落が別でも通し番号。id も文で分かれる
    expect(sentences.value[1].tokens[0].id).not.toBe(sentences.value[0].tokens[0].id);
    expect(sp.stop).toHaveBeenCalledTimes(1);
    expect(sp.setSentence).toHaveBeenNthCalledWith(1, 0, expect.objectContaining({ text: 'しゅうきんぺいは会談した。' }));
    expect(sp.setSentence).toHaveBeenNthCalledWith(2, 1, expect.objectContaining({ text: '習近平が話した。' }));
    expect(sp.play).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[V4\].*\d+ ms$/));
    expect(translating.value).toBe(false);
  });

  it('翻訳中にもう一度翻訳すると前回を中断し、前回の文は出さない', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      if (!firstSignal) {
        firstSignal = init.signal!;
        // 中断されるまで返さない
        return new Promise<Response>((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
        );
      }
      return Promise.resolve(sseResponse([S1]));
    });
    const { env } = makeEnv(fetchImpl as unknown as typeof fetch);
    const first = translate({ ...REQ, text: 'a' }, env);
    expect(translating.value).toBe(true);
    await translate({ ...REQ, text: 'b' }, env);
    await first;

    expect(firstSignal!.aborted).toBe(true);
    expect(sentences.value.map((s) => s.ja)).toEqual(['習近平が話した。']);
    expect(translating.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it('HTTP エラーは GroqError として error に入り、再試行で同じ依頼をやり直す', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(sseResponse([S0]));
    const { env } = makeEnv(fetchImpl as unknown as typeof fetch);
    await translate({ ...REQ, text: 'only' }, env);
    expect(error.value).toMatchObject({ kind: 'auth', message: 'key が使えません' });
    expect(translating.value).toBe(false);

    await retry(env);
    expect(error.value).toBeNull();
    expect(sentences.value).toHaveLength(1);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).messages[1].content).toBe('only');
  });
});

describe('translate の辞書ヒント', () => {
  it('辞書は全件ではなく、原文に出てくる語だけをプロンプトに入れる（§3.4）', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([S0]));
    const entry = (word: string, reading: string) => ({ word, reading, source: 'manual' as const, createdAt: 'x' });
    const { env } = makeEnv(fetchImpl as unknown as typeof fetch, {
      dict: { version: 1, entries: [entry('習近平', 'しゅうきんぺい'), entry('東雲', 'しののめ')] },
    });
    await translate({ ...REQ, text: '习近平と習近平' }, env);
    const system = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).messages[0].content;
    expect(system).toContain('習近平=しゅうきんぺい');
    expect(system).not.toContain('東雲');
  });
});

describe('applyFix / rebuildAll', () => {
  async function twoSentences(opts?: { dict?: DictData; analyzer?: Analyzer | null }) {
    const fetchImpl = vi.fn().mockResolvedValueOnce(sseResponse([S0])).mockResolvedValueOnce(sseResponse([S1]));
    const r = makeEnv(fetchImpl as unknown as typeof fetch, opts);
    await translate(REQ, r.env);
    r.sp.setSentence.mockClear();
    return r;
  }

  it('この文だけ直すと、その文だけ作り直して読み直す', async () => {
    const { env, sp } = await twoSentences();
    applyFix({ sentence: 1, word: '習近平', reading: 'しーじんぴん', target: 'once' }, env);

    expect(sentences.value[1].tokens.find((t) => t.text === '習近平')).toMatchObject({ fix: 'once', reading: 'しーじんぴん' });
    // 0 文目は AI の読みのまま
    expect(sentences.value[0].tokens.find((t) => t.text === '習近平')).toMatchObject({ fix: 'ai' });
    expect(sp.setSentence).toHaveBeenCalledTimes(1);
    expect(sp.setSentence).toHaveBeenCalledWith(1, expect.objectContaining({ text: 'しーじんぴんが話した。' }));
    expect(sp.respeakFrom).toHaveBeenCalledWith(1);
    expect(env.setDict).not.toHaveBeenCalled();
  });

  it('辞書に登録して直すと、辞書に入れて全文を作り直す', async () => {
    const { env, sp } = await twoSentences();
    applyFix({ sentence: 0, word: '会談', reading: 'かいだん', target: 'dict' }, env);

    expect(env.setDict).toHaveBeenCalledWith({
      version: 1,
      entries: [expect.objectContaining({ word: '会談', reading: 'かいだん', source: 'translation' })],
    });
    expect(sentences.value[0].tokens.find((t) => t.text === '会談')).toMatchObject({ fix: 'dict', reading: 'かいだん' });
    expect(sp.setSentence).toHaveBeenCalledTimes(2);
    expect(sp.respeakFrom).toHaveBeenCalledWith(0);
  });

  it('解析器が後から届いたら作り直すと自動解析の読みが付く', async () => {
    const { env, setAnalyzer } = await twoSentences();
    expect(sentences.value[0].tokens.find((t) => t.text === '会談')?.reading).toBeNull();
    setAnalyzer({
      // 「会談」だけ読みを返す最小の解析器
      tokenize: (text) =>
        text.split(/(会談)/).filter(Boolean).map((surface) => ({ surface, reading: surface === '会談' ? 'かいだん' : null })),
    });
    rebuildAll(env);
    expect(sentences.value[0].tokens.find((t) => t.text === '会談')).toMatchObject({ fix: 'none', reading: 'かいだん' });
  });

  it('作り直しても選択中の語を指し続け、分け方が変わってその語が無くなれば選択を外す', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([{ i: 0, ja: '今日は会談した。', readings: [] }]));
    const { env, setAnalyzer } = makeEnv(fetchImpl as unknown as typeof fetch);
    await translate({ ...REQ, text: 'a' }, env);
    // 解析器が無いうちは「今日」「は」「会談」…
    const before = sentences.value[0].tokens.find((t) => t.text === '会談')!;
    selection.value = { sentence: 0, tokenId: before.id };
    // 「今日」を 1 字ずつに分ける解析器にすると、後ろの「会談」の id がずれる
    setAnalyzer({
      tokenize: (text) =>
        text.split(/(会談)/).filter(Boolean).flatMap((p) => (p === '会談' ? [p] : [...p])).map((surface) => ({ surface, reading: null })),
    });
    rebuildAll(env);
    const after = sentences.value[0].tokens.find((t) => t.text === '会談')!;
    expect(after.id).not.toBe(before.id);
    expect(selection.value).toEqual({ sentence: 0, tokenId: after.id });

    // 「会談」を「会」「談」に分けると選んでいた語は無くなる
    setAnalyzer({ tokenize: (text) => [...text].map((surface) => ({ surface, reading: null })) });
    rebuildAll(env);
    expect(selection.value).toBeNull();
  });

  it('直した読みの一覧は語ごとに 1 件、最初に出た文を指す', async () => {
    const { env } = await twoSentences({ dict: { version: 1, entries: [{ word: '会談', reading: 'かいだん', source: 'manual', createdAt: 'x' }] } });
    applyFix({ sentence: 1, word: '習近平', reading: 'しーじんぴん', target: 'once' }, env);
    expect(fixedWords(sentences.value).map((w) => [w.word, w.reading, w.fix, w.sentence])).toEqual([
      ['習近平', 'しゅうきんぺい', 'ai', 0],
      ['会談', 'かいだん', 'dict', 0],
    ]);
  });
});
