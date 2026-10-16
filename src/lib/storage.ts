// localStorage への保存（spec §7）。使えない環境ではメモリに持ってその場限りで動く。
import type { DictData, DictEntry, Settings } from '../types';
import { DEFAULT_MODEL } from './groq';
import { hasKanji } from './analyzer';

const KEY_GROQ = 'yomiage.groqKey';
const KEY_SETTINGS = 'yomiage.settings';
const KEY_DICT = 'yomiage.dict';

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

export function getKey(): string | null {
  return read(KEY_GROQ);
}

export function setKey(k: string): void {
  write(KEY_GROQ, k);
}

export function clearKey(): void {
  remove(KEY_GROQ);
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
  // 型が合う項目だけ採り、ほかは既定値
  return {
    model: typeof o.model === 'string' && o.model !== '' ? o.model : d.model,
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
