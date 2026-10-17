// 共有の型。docs/spec.md の §3.3・§4.2・§7 に対応する。

export type Fix = 'none' | 'ai' | 'once' | 'dict';

export interface Token {
  id: number;
  sentence: number; // 文番号
  text: string; // 表示する文字列
  reading: string | null; // ひらがな。漢字を含まない語は null
  fix: Fix; // 'none' は自動解析の読み
  start: number; // 訳文の中での開始位置（文字数）
}

export interface AiReading {
  w: string;
  r: string;
}

/** Groq が 1 行で返す 1 文（§3.3） */
export interface Sentence {
  i: number;
  p?: number; // 1 回の入力の中での段落番号（§3.5）。モデルが付けなければ無い
  ja: string;
  readings: AiReading[];
}

/** 訳し終えた塊の 1 文。再試行のときにメモリから使う（§3.5）。文番号は渡すときに振り直すので持たない */
export interface SavedSentence {
  p: number; // 塊の中での段落番号（直前の文に合わせた後の値）
  ja: string;
  readings: AiReading[];
}

export interface DictEntry {
  word: string;
  reading: string;
  source: 'manual' | 'translation';
  createdAt: string;
}

export interface DictData {
  version: 1;
  entries: DictEntry[];
}

export interface Settings {
  model: string;
  voiceURI: string;
  rate: number;
  showAllRuby: boolean;
}

/** 音声テキストの範囲 → トークン id（§5） */
export interface SpeechSpan {
  start: number;
  end: number;
  tokenId: number;
}

export interface SpeechText {
  text: string;
  map: SpeechSpan[];
}

export type GroqErrorKind = 'auth' | 'rate' | 'network' | 'other';

export interface GroqError {
  kind: GroqErrorKind;
  message: string; // 画面に出す日本語（§3.6）
  retryAfterSec?: number;
  scope?: 'minute' | 'day'; // 429 で当たった枠（§3.6）
}
