// localStorage への保存（spec §7）。使えない環境ではメモリに持ってその場限りで動く。
import type { DictData, DictEntry, SavedSentence, Settings } from '../types';
import { DEFAULT_MODEL, MODELS } from './groq';
import { hasKanji } from './analyzer';

const KEY_GROQ = 'yomiage.groqKey';
const KEY_SETTINGS = 'yomiage.settings';
const KEY_DICT = 'yomiage.dict';
const KEY_CHUNKS = 'yomiage.chunks';

const memory = new Map<string, string>();

export function storageAvailable(): boolean {
  try {
    const probe = 'yomiage.__probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function read(key: string): string | null {
  if (storageAvailable()) return localStorage.getItem(key);
  return memory.get(key) ?? null;
}

function write(key: string, value: string): void {
  if (storageAvailable()) localStorage.setItem(key, value);
  else memory.set(key, value);
}

function remove(key: string): void {
  if (storageAvailable()) localStorage.removeItem(key);
  memory.delete(key);
}

function parseJson(s: string | null): unknown {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---- API key ----

/** 覚えておかない key の置き場。タブを閉じると消える。使えなければ null（key は画面の状態にだけ残る） */
function sessionStore(): Storage | null {
  try {
    const probe = 'yomiage.__probe__';
    sessionStorage.setItem(probe, '1');
    sessionStorage.removeItem(probe);
    return sessionStorage;
  } catch {
    return null;
  }
}

export function getKey(): string | null {
  return read(KEY_GROQ) ?? sessionStore()?.getItem(KEY_GROQ) ?? null;
}

/** key をこのブラウザに覚えている（タブを閉じても残る）か */
export function isKeyRemembered(): boolean {
  return read(KEY_GROQ) !== null;
}

/** remember が false なら、タブを閉じたら消える場所にだけ置く */
export function setKey(k: string, remember = true): void {
  if (remember) {
    write(KEY_GROQ, k);
    sessionStore()?.removeItem(KEY_GROQ);
  } else {
    remove(KEY_GROQ);
    sessionStore()?.setItem(KEY_GROQ, k);
  }
}

export function clearKey(): void {
  remove(KEY_GROQ);
  sessionStore()?.removeItem(KEY_GROQ);
}

// ---- 設定 ----

function defaultSettings(): Settings {
  return { model: DEFAULT_MODEL, voiceURI: '', rate: 1, showAllRuby: false };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  const v = parseJson(read(KEY_SETTINGS));
  if (typeof v !== 'object' || v === null) return d;
  const o = v as Record<string, unknown>;
  // 型が合う項目だけ採り、ほかは既定値。モデルは選択肢にあるものだけ（提供が終わったモデルは既定に戻す）
  return {
    model: MODELS.some((m) => m.id === o.model) ? (o.model as string) : d.model,
    voiceURI: typeof o.voiceURI === 'string' ? o.voiceURI : d.voiceURI,
    rate: typeof o.rate === 'number' && Number.isFinite(o.rate) && o.rate > 0 ? o.rate : d.rate,
    showAllRuby: typeof o.showAllRuby === 'boolean' ? o.showAllRuby : d.showAllRuby,
  };
}

export function saveSettings(s: Settings): void {
  write(KEY_SETTINGS, JSON.stringify(s));
}

// ---- 辞書 ----

export function isHiragana(s: string): boolean {
  return /^[ぁ-ゖゝゞー]+$/.test(s);
}

function isEntry(v: unknown): v is DictEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.word === 'string' &&
    // 読みを固定できるのは漢字を含む語だけ（§4.2）
    hasKanji(e.word) &&
    typeof e.reading === 'string' &&
    isHiragana(e.reading) &&
    (e.source === 'manual' || e.source === 'translation') &&
    typeof e.createdAt === 'string'
  );
}

/** 辞書データとして正しければ返す。違えばエラー文 */
function validateDict(v: unknown): DictData | string {
  if (typeof v !== 'object' || v === null) return '辞書の形式ではありません';
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return `対応していない辞書の版です（version: ${String(o.version)}）`;
  if (!Array.isArray(o.entries)) return '辞書の形式ではありません（entries がありません）';
  const bad = o.entries.findIndex((e) => !isEntry(e));
  if (bad >= 0) return `${bad + 1} 件目の項目が正しくありません`;
  return { version: 1, entries: o.entries as DictEntry[] };
}

export function loadDict(): DictData {
  const v = parseJson(read(KEY_DICT));
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  if (o?.version !== 1 || !Array.isArray(o.entries)) return { version: 1, entries: [] };
  // 保存済みの辞書は、正しくない項目だけ捨てる（1 件のせいで全部を失わないように）
  return { version: 1, entries: o.entries.filter(isEntry) };
}

export function saveDict(d: DictData): void {
  write(KEY_DICT, JSON.stringify(d));
}

/** 同じ word があれば読みと出どころを置き換える（createdAt は最初に登録した日時のまま） */
export function upsertEntry(
  d: DictData,
  e: { word: string; reading: string; source: 'manual' | 'translation' },
  now: string = new Date().toISOString(),
): DictData {
  const i = d.entries.findIndex((x) => x.word === e.word);
  if (i < 0) {
    return { version: 1, entries: [...d.entries, { ...e, createdAt: now }] };
  }
  const entries = d.entries.slice();
  entries[i] = { ...e, createdAt: d.entries[i].createdAt };
  return { version: 1, entries };
}

export function removeEntry(d: DictData, word: string): DictData {
  return { version: 1, entries: d.entries.filter((x) => x.word !== word) };
}

export function exportDict(d: DictData): string {
  return JSON.stringify(d, null, 2);
}

export function importDict(
  current: DictData,
  json: string,
): { ok: true; dict: DictData; count: number } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON として読めません' };
  }
  const d = validateDict(v);
  if (typeof d === 'string') return { ok: false, error: d };
  // 同じ word は読み込んだ方で上書き
  const incoming = new Map(d.entries.map((e) => [e.word, e]));
  const kept = current.entries.filter((e) => !incoming.has(e.word));
  return { ok: true, dict: { version: 1, entries: [...kept, ...incoming.values()] }, count: incoming.size };
}

// ---- 訳し終えた塊 ----

/** 保存しておく塊の数の上限。超えたら保存した順に古いものから捨てる */
export const CHUNK_LIMIT = 100;

/** 文字列のハッシュ（cyrb53）。原文をキーに入れないために使う */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 塊を保存するキー。モデル・原文の言語・塊の原文のハッシュで作る（辞書は含めない） */
export function chunkKey(model: string, sourceLang: string, text: string): string {
  return `${model}|${sourceLang}|${hash(text)}`;
}

type SavedChunk = { key: string; sentences: SavedSentence[] };

function isSavedSentence(v: unknown): v is SavedSentence {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    Number.isInteger(s.p) &&
    (s.p as number) >= 0 &&
    typeof s.ja === 'string' &&
    Array.isArray(s.readings) &&
    s.readings.every((r) => typeof r?.w === 'string' && typeof r?.r === 'string')
  );
}

function loadChunks(): SavedChunk[] {
  const v = parseJson(read(KEY_CHUNKS));
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  if (o?.version !== 1 || !Array.isArray(o.entries)) return [];
  return o.entries.filter(
    (e): e is SavedChunk => typeof e?.key === 'string' && Array.isArray(e.sentences) && e.sentences.every(isSavedSentence),
  );
}

export function loadChunk(key: string): SavedSentence[] | null {
  return loadChunks().find((e) => e.key === key)?.sentences ?? null;
}

/** 書き込めなくても（容量超過など）投げない。保存できなかった塊は次に訳すとき要求し直すだけ */
export function saveChunk(key: string, sentences: SavedSentence[]): void {
  const entries = [...loadChunks().filter((e) => e.key !== key), { key, sentences }].slice(-CHUNK_LIMIT);
  try {
    write(KEY_CHUNKS, JSON.stringify({ version: 1, entries }));
  } catch {
    // 保存は諦めて翻訳を続ける
  }
}
