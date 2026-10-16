import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hasKanji, katakanaToHiragana, loadAnalyzer, type Analyzer } from './analyzer';

// ブラウザ用 bundle は XHR で辞書を取るので、テストでは同じ実装の Node 版（fs で読む）に差し替える
vi.mock('kuromoji/build/kuromoji.js', async () => ({ default: (await import('kuromoji')).default }));

// Node 版は fs で読むので、リポジトリ直下（vitest の cwd）からの相対パスで渡す
const dicPath = 'node_modules/kuromoji/dict/';

describe('katakanaToHiragana', () => {
  it('カタカナをひらがなにし、長音符や他の文字は残す', () => {
    expect(katakanaToHiragana('コウイケイショウ')).toBe('こういけいしょう');
    expect(katakanaToHiragana('ヴァイオリン')).toBe('ゔぁいおりん');
    expect(katakanaToHiragana('コーヒーと漢字')).toBe('こーひーと漢字');
  });
});

describe('hasKanji', () => {
  it('漢字（々を含む）があるときだけ true', () => {
    expect(hasKanji('皇位')).toBe(true);
    expect(hasKanji('人々')).toBe(true);
    expect(hasKanji('々')).toBe(true);
    expect(hasKanji('ひらがなとカタカナ。')).toBe(false);
    expect(hasKanji('Xi 2024')).toBe(false);
  });
});

describe('loadAnalyzer（kuromoji の辞書を実際に読む）', () => {
  let analyzer: Analyzer;
  beforeAll(async () => {
    analyzer = await loadAnalyzer(dicPath);
  }, 60_000);

  it('皇位継承 を語に分けてひらがなの読みを付ける', () => {
    expect(analyzer.tokenize('皇位継承を議論する。')).toEqual([
      { surface: '皇位', reading: 'こうい' },
      { surface: '継承', reading: 'けいしょう' },
      { surface: 'を', reading: 'を' },
      { surface: '議論', reading: 'ぎろん' },
      { surface: 'する', reading: 'する' },
      { surface: '。', reading: null },
    ]);
  });

  it('健常 は けんじょう。未知語は読みなし、surface をつなぐと元の文になる', () => {
    const text = '健常な人と  Xi氏が会談した。';
    const ms = analyzer.tokenize(text);
    expect(ms.slice(0, 3)).toEqual([
      { surface: '健常', reading: 'けんじょう' },
      { surface: 'な', reading: 'な' },
      { surface: '人', reading: 'ひと' },
    ]);
    expect(ms.find((m) => m.surface === 'Xi')).toEqual({ surface: 'Xi', reading: null });
    expect(ms.map((m) => m.surface).join('')).toBe(text);
  });

  it('読みがかなにならない語（々 単独）は読みなし', () => {
    expect(analyzer.tokenize('々')).toEqual([{ surface: '々', reading: null }]);
  });

  it('辞書が無いパスでは reject する', async () => {
    await expect(loadAnalyzer('/nonexistent/dict/')).rejects.toBeTruthy();
  });
});
