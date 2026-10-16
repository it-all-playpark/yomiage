// 1 文をトークン列にする（§4.1・§4.2）
import type { AiReading, Fix, Token } from '../types';
import { hasKanji, katakanaToHiragana, type Analyzer } from './analyzer';
import { isHiragana } from './storage';

interface Fixed {
  reading: string;
  fix: Fix;
}

export function tokenizeSentence(opts: {
  sentence: number;
  text: string;
  ai: AiReading[];
  dict: Map<string, string>;
  once: Map<string, string>;
  analyzer: Analyzer | null;
  startId: number;
}): Token[] {
  const { sentence, text, analyzer } = opts;

  // 語ごとの固定読み。優先の低い順に入れて上書きする（dict > once > ai）
  const fixed = new Map<string, Fixed>();
  const add = (word: string, reading: string, fix: Fix) => {
    if (!word || !reading || !hasKanji(word)) return;
    const r = katakanaToHiragana(reading);
    // AI の読みはひらがなでなければ使わない（空白や記号入りを辞書に入れないため）
    if (fix === 'ai' && !isHiragana(r)) return;
    fixed.set(word, { reading: r, fix });
  };
  for (const { w, r } of opts.ai) add(w, r, 'ai');
  for (const [w, r] of opts.once) add(w, r, 'once');
  for (const [w, r] of opts.dict) add(w, r, 'dict');

  // 優先の高い出どころから順に、まだ固定されていない範囲で最長一致を取る（§4.1 を §4.2-1 より先に効かせる）
  const claimed: { start: number; word: string }[] = [];
  const taken = new Array<boolean>(text.length).fill(false);
  for (const level of ['dict', 'once', 'ai'] as const) {
    const words = [...fixed].filter(([, f]) => f.fix === level).map(([w]) => w).sort((a, b) => b.length - a.length);
    let i = 0;
    while (i < text.length) {
      const w = words.find((w) => text.startsWith(w, i) && !taken.slice(i, i + w.length).includes(true));
      if (!w) {
        i++;
        continue;
      }
      taken.fill(true, i, i + w.length);
      claimed.push({ start: i, word: w });
      i += w.length;
    }
  }
  claimed.sort((a, b) => a.start - b.start);

  const tokens: Token[] = [];
  let id = opts.startId;
  const push = (t: string, start: number, reading: string | null, fix: Fix) => {
    tokens.push({ id: id++, sentence, text: t, reading, fix, start });
  };

  // 固定語以外の区間を analyzer で分ける
  const analyzeGap = (from: number, to: number) => {
    if (from >= to) return;
    const gap = text.slice(from, to);
    if (analyzer) {
      let pos = from;
      for (const m of analyzer.tokenize(gap)) {
        push(m.surface, pos, hasKanji(m.surface) ? m.reading : null, 'none');
        pos += m.surface.length;
      }
      return;
    }
    // 解析器がまだ無いとき（V5）は漢字の連続と、それ以外の連続に分ける
    for (const m of gap.matchAll(/\p{Script=Han}+|[^\p{Script=Han}]+/gu)) {
      push(m[0], from + m.index, null, 'none');
    }
  };

  let gapStart = 0;
  for (const { start, word } of claimed) {
    analyzeGap(gapStart, start);
    const f = fixed.get(word)!;
    push(word, start, f.reading, f.fix);
    gapStart = start + word.length;
  }
  analyzeGap(gapStart, text.length);
  return tokens;
}
