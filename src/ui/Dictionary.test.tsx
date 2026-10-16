import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { DictData } from '../types';
import { Dictionary } from './Dictionary';
import { dict, speaker } from '../state';

vi.mock('../state', async () => {
  const { signal } = await import('@preact/signals');
  return {
    dict: signal({ version: 1, entries: [] }),
    speaker: { preview: vi.fn() },
  };
});

const preview = vi.mocked(speaker!.preview);

const SAMPLE: DictData = {
  version: 1,
  entries: [
    { word: '習近平', reading: 'しゅうきんぺい', source: 'translation', createdAt: '2026-01-01T00:00:00.000Z' },
    { word: '御用達', reading: 'ごようたし', source: 'manual', createdAt: '2026-01-02T00:00:00.000Z' },
  ],
};

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1);
}

beforeEach(() => {
  dict.value = structuredClone(SAMPLE);
  preview.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Dictionary 追加', () => {
  function fill(word: string, reading: string) {
    fireEvent.input(screen.getByLabelText('単語'), { target: { value: word } });
    fireEvent.input(screen.getByLabelText('読み（ひらがな）'), { target: { value: reading } });
  }

  it('ひらがなの読みなら手入力として追加し、一覧に出す', () => {
    render(<Dictionary />);
    fill('東海林', 'しょうじ');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(dict.value.entries.at(-1)).toMatchObject({ word: '東海林', reading: 'しょうじ', source: 'manual' });
    expect(screen.getByRole('cell', { name: '東海林' })).toBeTruthy();
    expect(screen.getByText('3 件')).toBeTruthy();
    expect((screen.getByLabelText('単語') as HTMLInputElement).value).toBe('');
  });

  it('読みがひらがなでなければ追加しない', () => {
    render(<Dictionary />);
    fill('東海林', 'ショウジ');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByRole('alert').textContent).toBe('読みはひらがなで入力してください。');
    expect(dict.value.entries).toHaveLength(2);
  });

  it('単語が空なら追加しない', () => {
    render(<Dictionary />);
    fill('  ', 'しょうじ');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByRole('alert').textContent).toBe('単語を入力してください。');
    expect(dict.value.entries).toHaveLength(2);
  });

  it('漢字を含まない単語は読みを固定できないので追加しない', () => {
    render(<Dictionary />);
    fill('NATO', 'なとー');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByRole('alert').textContent).toBe('漢字を含む単語を入力してください。');
    expect(dict.value.entries).toHaveLength(2);
  });

  it('追加前に読みを試聴できる', () => {
    render(<Dictionary />);
    fill('東海林', 'しょうじ');
    fireEvent.click(screen.getByRole('button', { name: '試聴' }));
    expect(preview).toHaveBeenCalledWith('しょうじ');
    expect(dict.value.entries).toHaveLength(2);
  });
});

describe('Dictionary 一覧', () => {
  it('登録元を日本語で出す', () => {
    render(<Dictionary />);
    const [first, second] = bodyRows();
    expect(within(first).getByText('翻訳画面から')).toBeTruthy();
    expect(within(second).getByText('手入力')).toBeTruthy();
  });

  it('単語か読みで絞り込める', () => {
    render(<Dictionary />);
    const q = screen.getByLabelText('絞り込み');
    fireEvent.input(q, { target: { value: 'ごよう' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole('cell', { name: '御用達' })).toBeTruthy();
    fireEvent.input(q, { target: { value: '習' } });
    expect(screen.getByRole('cell', { name: '習近平' })).toBeTruthy();
    fireEvent.input(q, { target: { value: 'ない語' } });
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(screen.getByText('「ない語」に当てはまる語はありません。')).toBeTruthy();
  });

  it('行の試聴で登録した読みを読む', () => {
    render(<Dictionary />);
    fireEvent.click(screen.getByRole('button', { name: '習近平 を試聴' }));
    expect(preview).toHaveBeenCalledWith('しゅうきんぺい');
  });

  it('読みを編集して保存できる。登録元と登録日時は変えない', () => {
    render(<Dictionary />);
    fireEvent.click(screen.getByRole('button', { name: '習近平 を編集' }));
    fireEvent.input(screen.getByLabelText('習近平 の読み'), { target: { value: 'しゅう・きんぺい' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    // ひらがな以外は弾く
    expect(screen.getByRole('alert').textContent).toBe('読みはひらがなで入力してください。');
    expect(dict.value.entries[0].reading).toBe('しゅうきんぺい');

    fireEvent.input(screen.getByLabelText('習近平 の読み'), { target: { value: 'しゅーきんぺー' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(dict.value.entries[0]).toEqual({ ...SAMPLE.entries[0], reading: 'しゅーきんぺー' });
    expect(screen.queryByLabelText('習近平 の読み')).toBeNull();
    expect(screen.getByRole('cell', { name: 'しゅーきんぺー' })).toBeTruthy();
  });

  it('編集は「やめる」で元に戻る', () => {
    render(<Dictionary />);
    fireEvent.click(screen.getByRole('button', { name: '御用達 を編集' }));
    fireEvent.input(screen.getByLabelText('御用達 の読み'), { target: { value: 'ごようだし' } });
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(dict.value.entries[1].reading).toBe('ごようたし');
    expect(screen.getByRole('cell', { name: 'ごようたし' })).toBeTruthy();
  });

  it('削除すると辞書と一覧から消える', () => {
    render(<Dictionary />);
    fireEvent.click(screen.getByRole('button', { name: '習近平 を削除' }));
    expect(dict.value.entries.map((e) => e.word)).toEqual(['御用達']);
    expect(screen.queryByRole('cell', { name: '習近平' })).toBeNull();
    expect(screen.getByText('1 件')).toBeTruthy();
  });
});

describe('Dictionary フォーカス（NFR-6）', () => {
  it('編集を始めると読みの入力欄へ、保存・やめる・Escape の後はその行の編集ボタンへ移す', () => {
    render(<Dictionary />);
    fireEvent.click(screen.getByRole('button', { name: '習近平 を編集' }));
    expect(document.activeElement).toBe(screen.getByLabelText('習近平 の読み'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '習近平 を編集' }));

    fireEvent.click(screen.getByRole('button', { name: '御用達 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '御用達 を編集' }));

    fireEvent.click(screen.getByRole('button', { name: '御用達 を編集' }));
    fireEvent.keyDown(screen.getByLabelText('御用達 の読み'), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '御用達 を編集' }));
  });

  it('削除すると次の行（無ければ前の行）の削除ボタンへ、行が無くなれば単語の入力欄へ移す', () => {
    render(<Dictionary />);
    fireEvent.click(screen.getByRole('button', { name: '習近平 を削除' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '御用達 を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '御用達 を削除' }));
    expect(document.activeElement).toBe(screen.getByLabelText('単語'));
  });
});

describe('Dictionary 書き出し・読み込み', () => {
  it('書き出しで辞書の JSON を Blob でダウンロードさせる', async () => {
    let blob: Blob | null = null;
    // jsdom には createObjectURL が無いので差し替える
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('yomiage-dict.json');
      expect(this.href).toBe('blob:x');
    });
    render(<Dictionary />);
    fireEvent.click(screen.getByRole('button', { name: '書き出し' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await blob!.text())).toEqual(SAMPLE);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  function upload(content: string) {
    const input = screen.getByLabelText('辞書ファイルを読み込む') as HTMLInputElement;
    const file = new File([content], 'dict.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  }

  it('読み込むと同じ語は読み込んだ方で上書きし、件数を知らせる', async () => {
    render(<Dictionary />);
    upload(
      JSON.stringify({
        version: 1,
        entries: [
          { word: '御用達', reading: 'ごようだち', source: 'manual', createdAt: '2026-02-01T00:00:00.000Z' },
          { word: '健常', reading: 'けんじょう', source: 'manual', createdAt: '2026-02-02T00:00:00.000Z' },
        ],
      }),
    );
    await screen.findByText('2 件を読み込みました。');
    expect(dict.value.entries.map((e) => [e.word, e.reading])).toEqual([
      ['習近平', 'しゅうきんぺい'],
      ['御用達', 'ごようだち'],
      ['健常', 'けんじょう'],
    ]);
    expect(screen.getByRole('cell', { name: '健常' })).toBeTruthy();
  });

  it('版が違うファイルは読み込まず、理由を出す', async () => {
    render(<Dictionary />);
    upload(JSON.stringify({ version: 2, entries: [] }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('version'));
    expect(screen.getByRole('alert').textContent).toContain('読み込めませんでした');
    expect(dict.value).toEqual(SAMPLE);
  });

  it('壊れた JSON は読み込まない', async () => {
    render(<Dictionary />);
    upload('{not json');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('JSON として読めません'));
    expect(dict.value).toEqual(SAMPLE);
  });
});
