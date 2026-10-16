import { describe, expect, it } from 'vitest';
import type { AiReading, Token } from '../types';
import type { Analyzer } from './analyzer';
import { tokenizeSentence } from './tokenize';

// 表にある語を最長一致で切り、無い文字は 1 文字ずつ（読みなし）にする fake。渡された区間を記録する
function fakeAnalyzer(table: Record<string, string>) {
  const calls: string[] = [];
  const words = Object.keys(table).sort((a, b) => b.length - a.length);
  const analyzer: Analyzer = {
    tokenize(text) {
      calls.push(text);
      const out = [];
      let i = 0;
      while (i < text.length) {
        const w = words.find((w) => text.startsWith(w, i)) ?? text[i];
        out.push({ surface: w, reading: table[w] ?? null });
        i += w.length;
      }
      return out;
    },
  };
  return { analyzer, calls };
}

const TABLE = {
  中国: 'ちゅうごく',
  の: 'の',
  国家: 'こっか',
  主席: 'しゅせき',
  は: 'は',
  日本: 'にっぽん',
  首相: 'しゅしょう',
  と: 'と',
  会談: 'かいだん',
  した: 'した',
};

function run(opts: {
  text: string;
  ai?: AiReading[];
  dict?: Record<string, string>;
  once?: Record<string, string>;
  analyzer?: Analyzer | null;
  startId?: number;
  sentence?: number;
}): Token[] {
  return tokenizeSentence({
    sentence: opts.sentence ?? 0,
    text: opts.text,
    ai: opts.ai ?? [],
    dict: new Map(Object.entries(opts.dict ?? {})),
    once: new Map(Object.entries(opts.once ?? {})),
    analyzer: opts.analyzer === undefined ? fakeAnalyzer(TABLE).analyzer : opts.analyzer,
    startId: opts.startId ?? 0,
  });
}

const brief = (ts: Token[]) => ts.map((t) => [t.text, t.reading, t.fix]);

describe('tokenizeSentence', () => {
  const text = '中国の習近平国家主席は日本の首相と会談した。';

  it('AI の語を 1 トークンに固定し、残りを analyzer で分ける', () => {
    const { analyzer, calls } = fakeAnalyzer(TABLE);
    const ts = run({ text, ai: [{ w: '習近平', r: 'しゅうきんぺい' }], analyzer });
    expect(brief(ts)).toEqual([
      ['中国', 'ちゅうごく', 'none'],
      ['の', null, 'none'],
      ['習近平', 'しゅうきんぺい', 'ai'],
      ['国家', 'こっか', 'none'],
      ['主席', 'しゅせき', 'none'],
      ['は', null, 'none'],
      ['日本', 'にっぽん', 'none'],
      ['の', null, 'none'],
      ['首相', 'しゅしょう', 'none'],
      ['と', null, 'none'],
      ['会談', 'かいだん', 'none'],
      ['した', null, 'none'],
      ['。', null, 'none'],
    ]);
    // 固定した語は analyzer に渡さない
    expect(calls).toEqual(['中国の', '国家主席は日本の首相と会談した。']);
  });

  it('優先順位は 辞書 > この文だけ > AI', () => {
    const ai = [
      { w: '日本', r: 'にほん' },
      { w: '首相', r: 'しゅそう' },
      { w: '会談', r: 'かいだん' },
    ];
    const ts = run({
      text,
      ai,
      once: { 日本: 'ひのもと', 首相: 'しゅしょう' },
      dict: { 日本: 'にっぽん' },
    });
    const pick = (w: string) => ts.find((t) => t.text === w)!;
    expect([pick('日本').reading, pick('日本').fix]).toEqual(['にっぽん', 'dict']);
    expect([pick('首相').reading, pick('首相').fix]).toEqual(['しゅしょう', 'once']);
    expect([pick('会談').reading, pick('会談').fix]).toEqual(['かいだん', 'ai']);
  });

  it('同じ語が文中に何度あってもすべて固定する', () => {
    const ts = run({ text, dict: { 日本: 'にっぽん', 中国: 'ちゅうごく' } });
    expect(ts.filter((t) => t.fix === 'dict').map((t) => t.text)).toEqual(['中国', '日本']);
    const ts2 = run({ text: '日本と日本', dict: { 日本: 'にほん' } });
    expect(brief(ts2)).toEqual([
      ['日本', 'にほん', 'dict'],
      ['と', null, 'none'],
      ['日本', 'にほん', 'dict'],
    ]);
  });

  it('出どころの優先が最長一致より先に効く：辞書の語を含む長い AI の語より辞書が勝つ（FR-5.3）', () => {
    const ts = run({
      text,
      dict: { 習近平: 'しゅうきんぺい' },
      ai: [{ w: '習近平国家主席', r: 'しゅうきんぺえこっかしゅせき' }],
    });
    expect(brief(ts).slice(2, 5)).toEqual([
      ['習近平', 'しゅうきんぺい', 'dict'],
      ['国家', 'こっか', 'none'],
      ['主席', 'しゅせき', 'none'],
    ]);
    expect(ts.some((t) => t.fix === 'ai')).toBe(false);

    // 同じ出どころの中では長い方を取る
    const ts2 = run({ text: '国家主席', dict: { 国家主席: 'こっかしゅせき', 国家: 'くにいえ' } });
    expect(brief(ts2)).toEqual([['国家主席', 'こっかしゅせき', 'dict']]);
    // 辞書と重ならない範囲の AI の語は使う
    const ts3 = run({ text: '習近平と会談', dict: { 習近平: 'しゅうきんぺい' }, ai: [{ w: '会談', r: 'かいだん' }] });
    expect(ts3.map((t) => t.fix)).toEqual(['dict', 'none', 'ai']);
  });

  it('ひらがなでない AI の読み（空白・記号入り）は使わない', () => {
    const ts = run({ text: '習近平氏', ai: [{ w: '習近平', r: 'しゅう きんぺい' }] });
    expect(ts.some((t) => t.fix === 'ai')).toBe(false);
    const ts2 = run({ text: '習近平氏', ai: [{ w: '習近平', r: 'しゅう・きんぺい' }] });
    expect(ts2.some((t) => t.fix === 'ai')).toBe(false);
  });

  it('start は訳文の中の位置、id は startId から連番、sentence を引き継ぐ', () => {
    const ts = run({ text, ai: [{ w: '習近平', r: 'しゅうきんぺい' }], startId: 100, sentence: 7 });
    for (const t of ts) expect(text.slice(t.start, t.start + t.text.length)).toBe(t.text);
    expect(ts.map((t) => t.id)).toEqual(ts.map((_, k) => 100 + k));
    expect(ts.every((t) => t.sentence === 7)).toBe(true);
    expect(ts.map((t) => t.text).join('')).toBe(text);
    expect(ts.find((t) => t.text === '習近平')!.start).toBe(3);
  });

  it('クリックできるのは漢字を含む語だけ（かな・記号は analyzer が読みを返しても null）', () => {
    const ts = run({ text: '日本の、ひらがなとカタカナ。' });
    const withReading = ts.filter((t) => t.reading !== null).map((t) => t.text);
    expect(withReading).toEqual(['日本']);
    // fake は「の」「と」に読みを返すが、漢字が無いので null
    expect(ts.find((t) => t.text === 'の')!.reading).toBeNull();
  });

  it('漢字を含まない語・空の読みは固定しない', () => {
    const { analyzer, calls } = fakeAnalyzer(TABLE);
    const ts = run({ text: 'AIと日本', ai: [{ w: 'AI', r: 'えーあい' }, { w: '日本', r: '' }], analyzer });
    expect(ts.every((t) => t.fix === 'none')).toBe(true);
    expect(calls).toEqual(['AIと日本']);
  });

  it('AI の読みがカタカナならひらがなにする', () => {
    const ts = run({ text: '習近平氏', ai: [{ w: '習近平', r: 'シュウキンペイ' }] });
    expect(ts[0]).toMatchObject({ text: '習近平', reading: 'しゅうきんぺい', fix: 'ai' });
  });

  it('文中に無い AI の語は無視する', () => {
    const ts = run({ text: '日本の首相', ai: [{ w: '中国', r: 'ちゅうごく' }] });
    expect(ts.some((t) => t.fix === 'ai')).toBe(false);
  });

  it('analyzer が null なら漢字の連続を読みなしの語にし、固定語はそのまま', () => {
    const ts = run({ text: '習近平国家主席は日本の首相。', analyzer: null, ai: [{ w: '習近平', r: 'しゅうきんぺい' }] });
    expect(brief(ts)).toEqual([
      ['習近平', 'しゅうきんぺい', 'ai'],
      ['国家主席', null, 'none'],
      ['は', null, 'none'],
      ['日本', null, 'none'],
      ['の', null, 'none'],
      ['首相', null, 'none'],
      ['。', null, 'none'],
    ]);
    expect(ts.map((t) => t.start)).toEqual([0, 3, 7, 8, 10, 11, 13]);
  });

  it('空文は空配列', () => {
    expect(run({ text: '' })).toEqual([]);
  });
});
