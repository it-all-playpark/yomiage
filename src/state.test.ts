import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// state.ts は読み込み時に localStorage と location.hash を読むので、テストごとに読み直す
async function load() {
  vi.resetModules();
  return import('./state');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ルーティング', () => {
  it('起動時のハッシュから画面を決め、知らないハッシュは翻訳画面', async () => {
    history.replaceState(null, '', '/#/dict');
    expect((await load()).route.value).toBe('#/dict');
    history.replaceState(null, '', '/#/foo');
    expect((await load()).route.value).toBe('#/');
  });

  it('#/?text= で開くと本文を取り出し、ハッシュを #/ に戻して翻訳画面にする', async () => {
    history.replaceState(null, '', '/yomiage/?x=1#/?text=Hello+world%E3%80%82%0A2%25');
    const s = await load();
    expect(s.sharedText.value).toBe('Hello world。\n2%');
    expect(location.pathname + location.search + location.hash).toBe('/yomiage/?x=1#/');
    expect(s.route.value).toBe('#/');
  });

  it('text が無い・空白だけなら本文は無い', async () => {
    history.replaceState(null, '', '/#/?text=%20%0A');
    expect((await load()).sharedText.value).toBeNull();
    history.replaceState(null, '', '/#/dict');
    const s = await load();
    expect(s.sharedText.value).toBeNull();
    expect(location.hash).toBe('#/dict');
  });

  it('navigate でハッシュと route が変わる', async () => {
    const s = await load();
    s.navigate('#/setup');
    expect(location.hash).toBe('#/setup');
    expect(s.route.value).toBe('#/setup');
  });

  it('hashchange（リンクや戻る）で route が追従する', async () => {
    const s = await load();
    location.hash = '#/dict';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(s.route.value).toBe('#/dict');
  });

  it('key が未登録なら起動時に設定画面へ移る', async () => {
    const s = await load();
    s.redirectIfNoKey();
    expect(s.route.value).toBe('#/setup');
  });

  it('key があれば移らない', async () => {
    localStorage.setItem('yomiage.groqKey', 'gsk_x');
    const s = await load();
    s.redirectIfNoKey();
    expect(s.route.value).toBe('#/');
  });
});

describe('保存', () => {
  it('apiKey を変えると保存され、null で消える', async () => {
    const s = await load();
    s.apiKey.value = 'gsk_abc';
    expect(localStorage.getItem('yomiage.groqKey')).toBe('gsk_abc');
    s.apiKey.value = null;
    expect(localStorage.getItem('yomiage.groqKey')).toBeNull();
  });

  it('rememberKey を外すと key をタブ限りにし、読み直すと外したまま key を戻す', async () => {
    const s = await load();
    expect(s.rememberKey.value).toBe(true);
    s.apiKey.value = 'gsk_abc';
    s.rememberKey.value = false;
    expect(localStorage.getItem('yomiage.groqKey')).toBeNull();
    expect(sessionStorage.getItem('yomiage.groqKey')).toBe('gsk_abc');
    const again = await load();
    expect(again.apiKey.value).toBe('gsk_abc');
    expect(again.rememberKey.value).toBe(false);
  });

  it('settings と dict は変更時に保存される', async () => {
    const s = await load();
    s.settings.value = { ...s.settings.value, rate: 1.5 };
    expect(JSON.parse(localStorage.getItem('yomiage.settings')!).rate).toBe(1.5);
    const entry = { word: '習近平', reading: 'しゅうきんぺい', source: 'manual' as const, createdAt: 'x' };
    s.dict.value = { version: 1, entries: [entry] };
    expect(JSON.parse(localStorage.getItem('yomiage.dict')!).entries).toEqual([entry]);
  });

  it('保存済みの値を起動時に読み込む', async () => {
    localStorage.setItem('yomiage.settings', JSON.stringify({ model: 'openai/gpt-oss-120b', voiceURI: 'v', rate: 2, showAllRuby: true }));
    const s = await load();
    expect(s.settings.value).toEqual({ model: 'openai/gpt-oss-120b', voiceURI: 'v', rate: 2, showAllRuby: true });
    expect(s.storageOk).toBe(true);
  });

  it('localStorage が使えなければ storageOk は false', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect((await load()).storageOk).toBe(false);
  });
});

describe('読み上げ', () => {
  it('speechSynthesis が無ければ speaker は null、声は空', async () => {
    const s = await load();
    expect(s.speaker).toBeNull();
    expect(s.voices.value).toEqual([]);
  });

  it('声の一覧は voiceschanged で取り直し、設定の声と速さを Speaker に渡す', async () => {
    const synth = Object.assign(new EventTarget(), {
      getVoices: vi.fn(() => [] as SpeechSynthesisVoice[]),
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    });
    vi.stubGlobal('speechSynthesis', synth);
    try {
      const s = await load();
      expect(s.speaker).not.toBeNull();
      const ja = { lang: 'ja-JP', voiceURI: 'nanami' } as SpeechSynthesisVoice;
      synth.getVoices.mockReturnValue([ja, { lang: 'en-US', voiceURI: 'aria' } as SpeechSynthesisVoice]);
      synth.dispatchEvent(new Event('voiceschanged'));
      expect(s.voices.value).toEqual([ja]);

      const setVoice = vi.spyOn(s.speaker!, 'setVoice');
      const setRate = vi.spyOn(s.speaker!, 'setRate');
      s.settings.value = { ...s.settings.value, voiceURI: 'nanami', rate: 1.2 };
      expect(setVoice).toHaveBeenCalledWith('nanami');
      expect(setRate).toHaveBeenCalledWith(1.2);
      // 声以外の変更では setVoice を呼ばない（boundary の判定を戻さない）
      setVoice.mockClear();
      s.settings.value = { ...s.settings.value, showAllRuby: true };
      expect(setVoice).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
