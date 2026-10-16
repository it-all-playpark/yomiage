// 音声に渡すテキストの組み立て（spec §5）
import type { SpeechSpan, SpeechText, Token } from '../types';

/** 直した語（fix !== 'none'）だけ読みに置き換え、位置 → トークン id の対応表を作る */
export function buildSpeechText(tokens: Token[]): SpeechText {
  let text = '';
  const map: SpeechSpan[] = [];
  for (const t of tokens) {
    const part = t.fix !== 'none' && t.reading !== null ? t.reading : t.text;
    map.push({ start: text.length, end: text.length + part.length, tokenId: t.id });
    text += part;
  }
  return { text, map };
}

/** boundary の charIndex が指すトークン id。範囲外は null */
export function tokenAtCharIndex(st: SpeechText, charIndex: number): number | null {
  const span = st.map.find((s) => s.start <= charIndex && charIndex < s.end);
  return span ? span.tokenId : null;
}
