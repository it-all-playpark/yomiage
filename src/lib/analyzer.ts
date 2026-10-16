// kuromoji による形態素解析（§4.2）。辞書の読み込みは重いので loadAnalyzer を呼んだときに動的 import する。
import type { IpadicFeatures, Tokenizer } from 'kuromoji';

export interface Morpheme {
  surface: string;
  reading: string | null; // ひらがな
}

export interface Analyzer {
  tokenize(text: string): Morpheme[];
}

export function katakanaToHiragana(s: string): string {
  // ァ(U+30A1)〜ヶ(U+30F6) をひらがなへ。長音符などはそのまま
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function hasKanji(s: string): boolean {
  return /\p{Script=Han}/u.test(s);
}

export async function loadAnalyzer(dicPath: string): Promise<Analyzer> {
  // src の入口は Node の path / fs に依存するため、ブラウザでも動く browserify 済みの bundle を使う
  // @ts-expect-error 型定義は 'kuromoji' 側にだけある
  const mod = await import('kuromoji/build/kuromoji.js');
  const kuromoji = (mod.default ?? mod) as typeof import('kuromoji');
  const tokenizer = await new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)));
  });
  return {
    tokenize(text) {
      return tokenizer.tokenize(text).map((t) => {
        const r = t.reading ? katakanaToHiragana(t.reading) : null;
        // 記号（。）や「々」単独のように読みがかなにならないものは読みなし扱い
        return { surface: t.surface_form, reading: r && /^[ぁ-ゖー]+$/.test(r) ? r : null };
      });
    },
  };
}
