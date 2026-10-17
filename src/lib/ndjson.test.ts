import { describe, expect, it } from 'vitest';
import { LineBuffer, parseSentenceLine, parseSseData } from './ndjson';

describe('LineBuffer', () => {
  it('行の途中で切れたチャンクは、改行が来るまで返さない', () => {
    const b = new LineBuffer();
    expect(b.push('{"i":0,"ja":"中')).toEqual([]);
    expect(b.push('国"}\n{"i":1')).toEqual(['{"i":0,"ja":"中国"}']);
    expect(b.push(',"ja":"x"}\n')).toEqual(['{"i":1,"ja":"x"}']);
    expect(b.flush()).toEqual([]);
  });

  it('1 チャンクに複数行あれば全部返し、CRLF の CR を落とす', () => {
    const b = new LineBuffer();
    expect(b.push('a\r\nb\n\nc')).toEqual(['a', 'b', '']);
    expect(b.flush()).toEqual(['c']);
    expect(b.flush()).toEqual([]);
  });
});

describe('parseSentenceLine', () => {
  it('正しい行を Sentence にする', () => {
    expect(parseSentenceLine('{"i":0,"ja":"習近平が来た。","readings":[{"w":"習近平","r":"しゅうきんぺい"}]}')).toEqual({
      i: 0,
      ja: '習近平が来た。',
      readings: [{ w: '習近平', r: 'しゅうきんぺい' }],
    });
  });

  it('readings が省かれていれば空配列', () => {
    expect(parseSentenceLine('{"i":3,"ja":"はい。"}')).toEqual({ i: 3, ja: 'はい。', readings: [] });
  });

  it('段落番号 p は 0 以上の整数なら持ち、形式違反なら文は残して p だけ落とす', () => {
    expect(parseSentenceLine('{"i":0,"p":2,"ja":"はい。"}')).toEqual({ i: 0, p: 2, ja: 'はい。', readings: [] });
    for (const p of ['-1', '1.5', '"1"']) {
      expect(parseSentenceLine(`{"i":0,"p":${p},"ja":"はい。"}`)).toEqual({ i: 0, ja: 'はい。', readings: [] });
    }
  });

  it.each([
    ['途中で切れた JSON', '{"i":0,"ja":"中国の'],
    ['JSON でない', 'こんにちは'],
    ['配列', '[1,2]'],
    ['i が無い', '{"ja":"a","readings":[]}'],
    ['i が小数', '{"i":1.5,"ja":"a","readings":[]}'],
    ['ja が空', '{"i":0,"ja":"","readings":[]}'],
    ['readings が配列でない', '{"i":0,"ja":"a","readings":"x"}'],
    ['readings の要素の形が違う', '{"i":0,"ja":"a","readings":[{"w":"語"}]}'],
  ])('%s は null', (_, line) => {
    expect(parseSentenceLine(line)).toBeNull();
  });
});

describe('parseSseData', () => {
  it('delta.content を取り出す', () => {
    expect(parseSseData('data: {"choices":[{"delta":{"content":"{\\"i\\""}}]}')).toBe('{"i"');
  });

  it('[DONE] は DONE', () => {
    expect(parseSseData('data: [DONE]')).toBe('DONE');
  });

  it('内容の無い行・data でない行・壊れた行は null', () => {
    expect(parseSseData('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
    expect(parseSseData('')).toBeNull();
    expect(parseSseData(': keep-alive')).toBeNull();
    expect(parseSseData('data: {"choices":')).toBeNull();
  });
});
