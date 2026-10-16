import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAnalyzer } from './analyzer';

// 本番と同じブラウザ用 bundle（XHR で辞書を取る）を通す。analyzer.test.ts は Node 版に差し替えているので別ファイルにする

// @types/node を入れていないので、必要な形だけ書く
type Fs = { readFile(path: string): Promise<Uint8Array> };

/** 取得先の URL を記録し、リポジトリ直下の public 相当（node_modules/kuromoji/）から辞書を返す XHR */
function fakeXhr(fs: Fs, requested: string[]) {
  return class {
    status = 0;
    statusText = '';
    response: ArrayBuffer | null = null;
    responseType = '';
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    private url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      requested.push(this.url);
      fs.readFile(`node_modules/kuromoji/${this.url}`).then(
        (b) => {
          this.status = 200;
          this.response = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
          this.onload?.call(this);
        },
        () => {
          this.status = 404;
          this.statusText = 'Not Found';
          this.onload?.call(this);
        },
      );
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadAnalyzer（ブラウザ用 bundle）', () => {
  it('本番の BASE_URL（vite.config の base "./"）+ "dict/" から相対パスで辞書を取り、文を分ける', async () => {
    const fs = (await import(/* @vite-ignore */ 'node:fs/promises' as string)) as Fs;
    const requested: string[] = [];
    vi.stubGlobal('XMLHttpRequest', fakeXhr(fs, requested));

    // vitest の BASE_URL は '/' になるので、build 後の値 './' を直接渡す（GitHub Pages のサブパスで動くように相対で取る）
    const analyzer = await loadAnalyzer('./' + 'dict/');

    expect(requested).toContain('dict/base.dat.gz');
    expect(requested.every((u) => u.startsWith('dict/'))).toBe(true);
    expect(analyzer.tokenize('皇位継承を議論する。').map((m) => [m.surface, m.reading])).toEqual([
      ['皇位', 'こうい'],
      ['継承', 'けいしょう'],
      ['を', 'を'],
      ['議論', 'ぎろん'],
      ['する', 'する'],
      ['。', null],
    ]);
  }, 60_000);
});
