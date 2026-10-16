import { describe, expect, it } from 'vitest';
import type { Token } from '../types';
import { buildSpeechText, tokenAtCharIndex } from './speechText';

function tok(id: number, text: string, reading: string | null, fix: Token['fix'], start: number): Token {
  return { id, sentence: 0, text, reading, fix, start };
}

// 中国の習近平国家主席は日本の首相と会談した。
const tokens: Token[] = [
  tok(0, '中国', 'ちゅうごく', 'none', 0),
  tok(1, 'の', null, 'none', 2),
  tok(2, '習近平', 'しゅうきんぺい', 'ai', 3),
  tok(3, '国家', 'こっか', 'none', 6),
  tok(4, '主席', 'しゅせき', 'once', 8),
  tok(5, 'は日本の', null, 'none', 10),
  tok(6, '首相', 'しゅしょう', 'dict', 14),
  tok(7, 'と会談した。', null, 'none', 16),
];

describe('buildSpeechText', () => {
  it('fix が none 以外の語だけ読みに置き換え、自動解析の読みは使わない', () => {
    expect(buildSpeechText(tokens).text).toBe('中国のしゅうきんぺい国家しゅせきは日本のしゅしょうと会談した。');
  });

  it('置き換え後の位置でトークン id の対応表を作る', () => {
    expect(buildSpeechText(tokens).map).toEqual([
      { start: 0, end: 2, tokenId: 0 },
      { start: 2, end: 3, tokenId: 1 },
      { start: 3, end: 10, tokenId: 2 },
      { start: 10, end: 12, tokenId: 3 },
      { start: 12, end: 16, tokenId: 4 },
      { start: 16, end: 20, tokenId: 5 },
      { start: 20, end: 25, tokenId: 6 },
      { start: 25, end: 31, tokenId: 7 },
    ]);
  });

  it('空のトークン列は空の文', () => {
    expect(buildSpeechText([])).toEqual({ text: '', map: [] });
  });
});

describe('tokenAtCharIndex', () => {
  const st = buildSpeechText(tokens);

  it('charIndex を含む範囲のトークンを返す（範囲の始まりと終わりの直前）', () => {
    expect(tokenAtCharIndex(st, 0)).toBe(0);
    expect(tokenAtCharIndex(st, 3)).toBe(2);
    expect(tokenAtCharIndex(st, 9)).toBe(2);
    expect(tokenAtCharIndex(st, 10)).toBe(3);
    expect(tokenAtCharIndex(st, 20)).toBe(6);
    expect(tokenAtCharIndex(st, 30)).toBe(7);
  });

  it('範囲外は null', () => {
    expect(tokenAtCharIndex(st, 31)).toBeNull();
    expect(tokenAtCharIndex(st, -1)).toBeNull();
  });
});
