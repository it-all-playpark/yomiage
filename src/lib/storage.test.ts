import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictData } from '../types';
import { DEFAULT_MODEL } from './groq';

// メモリ退避はモジュール内に持つので、テストごとに読み直す
async function load() {
  vi.resetModules();
  return import('./storage');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const entry = (word: string, reading: string, createdAt = '2026-01-01T00:00:00.000Z') => ({
  word,
  reading,
  source: 'manual' as const,
  createdAt,
});

describe('API key', () => {
  it('yomiage.groqKey に保存・削除する', async () => {
    const s = await load();
    expect(s.getKey()).toBeNull();
    s.setKey('gsk_abc');
    expect(localStorage.getItem('yomiage.groqKey')).toBe('gsk_abc');
    expect(s.getKey()).toBe('gsk_abc');
    s.clearKey();
    expect(localStorage.getItem('yomiage.groqKey')).toBeNull();
    expect(s.getKey()).toBeNull();
  });
});

describe('設定', () => {
  it('未保存なら既定値', async () => {
    const s = await load();
    expect(s.loadSettings()).toEqual({ model: DEFAULT_MODEL, voiceURI: '', rate: 1, showAllRuby: false });
  });

  it('yomiage.settings に保存して読み戻す', async () => {
    const s = await load();
    const v = { model: 'openai/gpt-oss-120b', voiceURI: 'v', rate: 1.5, showAllRuby: true };
    s.saveSettings(v);
    expect(JSON.parse(localStorage.getItem('yomiage.settings')!)).toEqual(v);
    expect(s.loadSettings()).toEqual(v);
  });

  it('壊れた値・型違いの項目は既定値にする', async () => {
    const s = await load();
    localStorage.setItem('yomiage.settings', '{broken');
    expect(s.loadSettings().model).toBe(DEFAULT_MODEL);
    localStorage.setItem('yomiage.settings', JSON.stringify({ model: 'openai/gpt-oss-120b', rate: 'fast', showAllRuby: 1 }));
    expect(s.loadSettings()).toEqual({ model: 'openai/gpt-oss-120b', voiceURI: '', rate: 1, showAllRuby: false });
  });

  it('選択肢に無いモデル（提供が終わったものなど）は既定のモデルにし、ほかの項目は残す', async () => {
    const s = await load();
    localStorage.setItem(
      'yomiage.settings',
      JSON.stringify({ model: 'llama-3.3-70b-versatile', voiceURI: 'v', rate: 1.5, showAllRuby: true }),
    );
    expect(s.loadSettings()).toEqual({ model: DEFAULT_MODEL, voiceURI: 'v', rate: 1.5, showAllRuby: true });
  });
});

describe('辞書の保存', () => {
  it('yomiage.dict に保存して読み戻す', async () => {
    const s = await load();
    const d: DictData = { version: 1, entries: [entry('東雲', 'しののめ')] };
    s.saveDict(d);
    expect(JSON.parse(localStorage.getItem('yomiage.dict')!)).toEqual(d);
    expect(s.loadDict()).toEqual(d);
  });

  it('未保存・壊れた値・版違いは空の辞書', async () => {
    const s = await load();
    expect(s.loadDict()).toEqual({ version: 1, entries: [] });
    localStorage.setItem('yomiage.dict', 'not json');
    expect(s.loadDict()).toEqual({ version: 1, entries: [] });
    localStorage.setItem('yomiage.dict', JSON.stringify({ version: 2, entries: [entry('東雲', 'しののめ')] }));
    expect(s.loadDict()).toEqual({ version: 1, entries: [] });
  });

  it('保存済みの辞書に正しくない項目があれば、その項目だけ捨てる', async () => {
    const s = await load();
    const good = entry('東雲', 'しののめ');
    localStorage.setItem(
      'yomiage.dict',
      JSON.stringify({ version: 1, entries: [entry('習近平', 'しゅう きんぺい'), good, entry('NATO', 'なとー')] }),
    );
    expect(s.loadDict()).toEqual({ version: 1, entries: [good] });
  });
});

describe('upsertEntry / removeEntry', () => {
  it('新しい語は now を createdAt にして足す', async () => {
    const s = await load();
    const d = s.upsertEntry({ version: 1, entries: [] }, { word: '東雲', reading: 'しののめ', source: 'manual' }, 'T1');
    expect(d.entries).toEqual([entry('東雲', 'しののめ', 'T1')]);
  });

  it('同じ語は読みと出どころを置き換え、createdAt は残す。元のデータは変えない', async () => {
    const s = await load();
    const before: DictData = { version: 1, entries: [entry('東雲', 'とううん', 'T0'), entry('灰汁', 'あく')] };
    const after = s.upsertEntry(before, { word: '東雲', reading: 'しののめ', source: 'translation' }, 'T9');
    expect(after.entries).toEqual([
      { word: '東雲', reading: 'しののめ', source: 'translation', createdAt: 'T0' },
      entry('灰汁', 'あく'),
    ]);
    expect(before.entries[0].reading).toBe('とううん');
  });

  it('removeEntry は指定の語だけ消す', async () => {
    const s = await load();
    const d: DictData = { version: 1, entries: [entry('東雲', 'しののめ'), entry('灰汁', 'あく')] };
    expect(s.removeEntry(d, '東雲').entries).toEqual([entry('灰汁', 'あく')]);
  });
});

describe('isHiragana', () => {
  it('ひらがなと長音だけを通す', async () => {
    const s = await load();
    expect(s.isHiragana('しののめ')).toBe(true);
    expect(s.isHiragana('らーめん')).toBe(true);
    expect(s.isHiragana('')).toBe(false);
    expect(s.isHiragana('シノノメ')).toBe(false);
    expect(s.isHiragana('東雲')).toBe(false);
    expect(s.isHiragana('abc')).toBe(false);
  });
});

describe('書き出し・読み込み', () => {
  it('書き出した JSON をそのまま読み込める', async () => {
    const s = await load();
    const d: DictData = { version: 1, entries: [entry('東雲', 'しののめ'), entry('灰汁', 'あく')] };
    const r = s.importDict({ version: 1, entries: [] }, s.exportDict(d));
    expect(r).toEqual({ ok: true, dict: d, count: 2 });
  });

  it('同じ語は読み込んだ方で上書きし、ほかは残す', async () => {
    const s = await load();
    const current: DictData = { version: 1, entries: [entry('東雲', 'とううん'), entry('灰汁', 'あく')] };
    const json = JSON.stringify({ version: 1, entries: [entry('東雲', 'しののめ', 'T5'), entry('鯔背', 'いなせ')] });
    const r = s.importDict(current, json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count).toBe(2);
    expect(r.dict.entries).toHaveLength(3);
    expect(r.dict.entries.find((e) => e.word === '東雲')).toEqual(entry('東雲', 'しののめ', 'T5'));
    expect(r.dict.entries.find((e) => e.word === '灰汁')).toEqual(entry('灰汁', 'あく'));
    expect(r.dict.entries.find((e) => e.word === '鯔背')).toEqual(entry('鯔背', 'いなせ'));
  });

  it('version 違いは読み込まない', async () => {
    const s = await load();
    const r = s.importDict({ version: 1, entries: [] }, JSON.stringify({ version: 2, entries: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('version');
  });

  it('壊れた JSON は読み込まない', async () => {
    const s = await load();
    const r = s.importDict({ version: 1, entries: [] }, '{"version":1,');
    expect(r).toEqual({ ok: false, error: 'JSON として読めません' });
  });

  it('形式違いの項目を含むものは読み込まない', async () => {
    const s = await load();
    const cases = [
      JSON.stringify([]),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ version: 1, entries: [{ word: '東雲', reading: 'シノノメ', source: 'manual', createdAt: 'T' }] }),
      JSON.stringify({ version: 1, entries: [{ word: '東雲', reading: 'しののめ', source: 'other', createdAt: 'T' }] }),
      JSON.stringify({ version: 1, entries: [{ word: '', reading: 'しののめ', source: 'manual', createdAt: 'T' }] }),
      // 漢字を含まない語は読みを固定できない
      JSON.stringify({ version: 1, entries: [{ word: 'NATO', reading: 'なとー', source: 'manual', createdAt: 'T' }] }),
    ];
    for (const json of cases) {
      expect(s.importDict({ version: 1, entries: [] }, json).ok).toBe(false);
    }
  });
});

describe('localStorage が使えない環境', () => {
  function breakStorage() {
    const err = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(err);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(err);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(err);
  }

  it('storageAvailable は使えるときだけ true', async () => {
    const s = await load();
    expect(s.storageAvailable()).toBe(true);
    breakStorage();
    expect(s.storageAvailable()).toBe(false);
  });

  it('throw せずメモリに保持してその場限りで動く', async () => {
    const s = await load();
    breakStorage();
    expect(s.getKey()).toBeNull();
    s.setKey('gsk_mem');
    expect(s.getKey()).toBe('gsk_mem');
    s.clearKey();
    expect(s.getKey()).toBeNull();

    const settings = { model: 'openai/gpt-oss-120b', voiceURI: 'v', rate: 2, showAllRuby: true };
    s.saveSettings(settings);
    expect(s.loadSettings()).toEqual(settings);

    const d: DictData = { version: 1, entries: [entry('東雲', 'しののめ')] };
    s.saveDict(d);
    expect(s.loadDict()).toEqual(d);
  });

  it('メモリの値は読み直す（画面を閉じる）と消える', async () => {
    breakStorage();
    const s1 = await load();
    s1.setKey('gsk_mem');
    const s2 = await load();
    expect(s2.getKey()).toBeNull();
  });
});
