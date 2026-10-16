import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

// state.ts が読み込み時に speechSynthesis を見るので、import より先に fake を置く
const synth = vi.hoisted(() => {
  class FakeUtterance {
    lang = '';
    rate = 1;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: ((e: { charIndex: number; name: string }) => void) | null = null;
    constructor(public text: string) {}
  }
  const s = {
    spoken: [] as FakeUtterance[],
    getVoices: () => [{ voiceURI: 'haruka', lang: 'ja-JP', name: 'Haruka', localService: true }],
    speak(u: FakeUtterance) {
      s.spoken.push(u);
      u.onstart?.();
    },
    cancel() {},
    pause() {},
    resume() {},
    addEventListener() {},
  };
  (globalThis as Record<string, unknown>).speechSynthesis = s;
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  return s;
});

import { analyzer, apiKey, dict, settings } from '../state';
import { resetSession } from '../session';
import { Main } from './Main';

const enc = new TextEncoder();

function sseResponse(lines: object[]): Response {
  const body =
    lines.map((l) => `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(l) + '\n' } }] })}\n\n`).join('') +
    'data: [DONE]\n\n';
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(body));
        c.close();
      },
    }),
    { status: 200 },
  );
}

const S0 = { i: 0, ja: '習近平は会談した。', readings: [{ w: '習近平', r: 'しゅうきんぺい' }] };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSession();
  synth.spoken = [];
  apiKey.value = 'gsk_test';
  dict.value = { version: 1, entries: [] };
  analyzer.value = null;
  settings.value = { ...settings.value, showAllRuby: false };
  fetchMock = vi.fn(async () => sseResponse([S0]));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function translateOnce() {
  render(<Main />);
  const ta = screen.getByLabelText('翻訳する文章');
  fireEvent.input(ta, { target: { value: 'Xi held talks.' } });
  fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
  return screen.findByRole('button', { name: '習近平（しゅうきんぺい）の読みを直す' });
}

describe('Main', () => {
  it('key が未登録なら設定画面へ誘導し、翻訳できない', () => {
    apiKey.value = null;
    render(<Main />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('link', { name: '設定画面で key を登録' }).getAttribute('href')).toBe('#/setup');
    fireEvent.input(screen.getByLabelText('翻訳する文章'), { target: { value: 'hello' } });
    expect((screen.getByRole('button', { name: '翻訳する' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Ctrl+Enter で翻訳し、届いた 1 文目を表示して読み上げる', async () => {
    const word = await translateOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // AI の語はオレンジ（tok-ai）でルビ付き
    expect(word.className).toContain('tok-ai');
    expect(word.querySelector('rt')?.textContent).toBe('しゅうきんぺい');
    expect(synth.spoken.map((u) => u.text)).toEqual(['しゅうきんぺいは会談した。']);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[V4]'));
  });

  it('読み上げ中は文をハイライトし、boundary が来たら語単位に切り替える', async () => {
    const word = await translateOnce();
    const sent = document.querySelector('[data-sentence="0"]')!;
    await waitFor(() => expect(sent.classList.contains('is-speaking')).toBe(true));
    expect(word.classList.contains('is-speaking')).toBe(false);

    synth.spoken[0].onboundary!({ charIndex: 0, name: 'word' });
    await waitFor(() => expect(word.classList.contains('is-speaking')).toBe(true));
    expect(sent.classList.contains('is-speaking')).toBe(false);
  });

  it('語をクリックするとパネルが開き、この文だけ直すとその文の読みと発話が変わる', async () => {
    fireEvent.click(await translateOnce());
    const panel = screen.getByRole('dialog', { name: '「習近平」の読みを直す' });
    expect(panel.textContent).toContain('今の読み：しゅうきんぺい（AI が付けた読み）');

    // カタカナで入れてもひらがなにして保存する
    fireEvent.input(within(panel).getByLabelText('読み（ひらがな）'), { target: { value: 'シージンピン' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'この文だけ直す' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const word = screen.getByRole('button', { name: '習近平（しーじんぴん）の読みを直す' });
    expect(word.className).toContain('tok-fixed');
    // 読み上げ中だったのでその文から読み直す
    expect(synth.spoken.at(-1)?.text).toBe('しーじんぴんは会談した。');
    expect(screen.getByText('この文だけ直した読み')).toBeTruthy();
    expect(dict.value.entries).toEqual([]);
  });

  it('試聴は入力中の読みだけを 1 発話で読む', async () => {
    fireEvent.click(await translateOnce());
    const panel = screen.getByRole('dialog');
    fireEvent.input(within(panel).getByLabelText('読み（ひらがな）'), { target: { value: 'シージンピン' } });
    fireEvent.click(within(panel).getByRole('button', { name: '試聴' }));
    expect(synth.spoken.at(-1)?.text).toBe('しーじんぴん');
  });

  it('試聴してから保存しても、試聴が終わればその文から読み直す（§6）', async () => {
    fireEvent.click(await translateOnce());
    const panel = screen.getByRole('dialog');
    fireEvent.input(within(panel).getByLabelText('読み（ひらがな）'), { target: { value: 'しーじんぴん' } });
    fireEvent.click(within(panel).getByRole('button', { name: '試聴' }));
    const pv = synth.spoken.at(-1)!;
    expect(pv.text).toBe('しーじんぴん');
    fireEvent.click(within(panel).getByRole('button', { name: 'この文だけ直す' }));
    pv.onend!();
    expect(synth.spoken.at(-1)?.text).toBe('しーじんぴんは会談した。');
  });

  it('パネルを閉じると選んでいた語のボタンへフォーカスを戻す（NFR-6）', async () => {
    fireEvent.click(await translateOnce());
    expect(document.activeElement).toBe(screen.getByLabelText('読み（ひらがな）'));
    fireEvent.keyDown(screen.getByLabelText('読み（ひらがな）'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '習近平（しゅうきんぺい）の読みを直す' }));

    fireEvent.click(screen.getByRole('button', { name: '習近平（しゅうきんぺい）の読みを直す' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '辞書に登録して直す' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '習近平（しゅうきんぺい）の読みを直す' }));
  });

  it('パネルを開いたまま解析器が届いて作り直しても、同じ語を指したまま下書きを残す', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([{ i: 0, ja: '今日は会談した。', readings: [] }]));
    render(<Main />);
    const ta = screen.getByLabelText('翻訳する文章');
    fireEvent.input(ta, { target: { value: 'a' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    fireEvent.click(await screen.findByRole('button', { name: '会談（読み未取得）の読みを直す' }));
    fireEvent.input(screen.getByLabelText('読み（ひらがな）'), { target: { value: 'かいだん' } });
    // 「今日」を 1 字ずつに分ける解析器が届くと、「会談」の id がずれる
    analyzer.value = {
      tokenize: (text) =>
        text.split(/(会談)/).filter(Boolean).flatMap((p) => (p === '会談' ? [p] : [...p])).map((surface) => ({ surface, reading: null })),
    };
    await screen.findByRole('button', { name: '今（読み未取得）の読みを直す' });
    const panel = screen.getByRole('dialog', { name: '「会談」の読みを直す' });
    expect((within(panel).getByLabelText('読み（ひらがな）') as HTMLInputElement).value).toBe('かいだん');
    fireEvent.click(within(panel).getByRole('button', { name: '辞書に登録して直す' }));
    expect(dict.value.entries).toEqual([expect.objectContaining({ word: '会談', reading: 'かいだん' })]);
  });

  it('再生状況の live region には状態だけを入れ、文の番号は外に出す', async () => {
    await translateOnce();
    const status = screen.getByRole('status');
    await waitFor(() => expect(status.textContent).toBe('読み上げ中'));
    expect(status.parentElement!.textContent).toBe('読み上げ中（1 / 1 文目）');
  });

  it('ひらがなでない読みは保存しない', async () => {
    fireEvent.click(await translateOnce());
    const panel = screen.getByRole('dialog');
    fireEvent.input(within(panel).getByLabelText('読み（ひらがな）'), { target: { value: 'xi' } });
    fireEvent.click(within(panel).getByRole('button', { name: '辞書に登録して直す' }));
    expect(screen.getByText('読みはひらがなで入力してください')).toBeTruthy();
    expect(dict.value.entries).toEqual([]);
  });

  it('辞書に登録して直すと辞書に入り、一覧で登録済みになる', async () => {
    fireEvent.click(await translateOnce());
    const panel = screen.getByRole('dialog');
    fireEvent.input(within(panel).getByLabelText('読み（ひらがな）'), { target: { value: 'しーじんぴん' } });
    fireEvent.click(within(panel).getByRole('button', { name: '辞書に登録して直す' }));

    expect(dict.value.entries).toEqual([expect.objectContaining({ word: '習近平', reading: 'しーじんぴん', source: 'translation' })]);
    expect(screen.getByText('辞書に登録済み')).toBeTruthy();
    expect(screen.getByText('辞書の読み')).toBeTruthy();
  });

  it('直した読みの一覧から辞書に追加できる', async () => {
    await translateOnce();
    fireEvent.click(screen.getByRole('button', { name: '習近平を辞書に追加' }));
    expect(dict.value.entries).toEqual([expect.objectContaining({ word: '習近平', reading: 'しゅうきんぺい' })]);
    await waitFor(() => expect(screen.getByText('辞書に登録済み')).toBeTruthy());
  });

  it('読み上げ用に切り替えると音声に渡す文を出す', async () => {
    await translateOnce();
    fireEvent.click(screen.getByRole('button', { name: '読み上げ用' }));
    expect(screen.getByRole('button', { name: '習近平（しゅうきんぺい）の読みを直す' }).textContent).toBe('しゅうきんぺい');
    expect(document.querySelector('.main-text')?.textContent).toContain('しゅうきんぺいは会談した。');
  });

  it('訳文は原文の段落ごとに分けて表示する', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse([{ i: 0, ja: '一。', readings: [] }, { i: 1, ja: '二。', readings: [] }]))
      .mockResolvedValueOnce(sseResponse([{ i: 0, ja: '三。', readings: [] }]));
    render(<Main />);
    const ta = screen.getByLabelText('翻訳する文章');
    fireEvent.input(ta, { target: { value: 'One. Two.\n\nThree.' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(document.querySelector('.main-receiving')).toBeNull());
    expect([...document.querySelectorAll('.main-text > p')].map((p) => p.textContent)).toEqual(['一。二。', '三。']);
  });

  it('ふりがなをすべて表示で、自動解析の語にもルビが付く（設定に保存）', async () => {
    await translateOnce();
    // 解析器が後から届くと全文を作り直す
    analyzer.value = {
      tokenize: (text) =>
        text.split(/(会談)/).filter(Boolean).map((surface) => ({ surface, reading: surface === '会談' ? 'かいだん' : null })),
    };
    const word = await screen.findByRole('button', { name: '会談（かいだん）の読みを直す' });
    expect(word.querySelector('rt')).toBeNull();
    fireEvent.click(screen.getByLabelText('ふりがなをすべて表示'));
    expect(word.querySelector('rt')?.textContent).toBe('かいだん');
    expect(JSON.parse(localStorage.getItem('yomiage.settings')!).showAllRuby).toBe(true);
  });

  it('401 は設定へのリンク、通信エラーは再試行ボタンを出す', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    render(<Main />);
    fireEvent.input(screen.getByLabelText('翻訳する文章'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: '翻訳する' }));
    const auth = await screen.findByText('key が使えません');
    expect(within(auth.parentElement!).getByRole('link').getAttribute('href')).toBe('#/setup');

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: '翻訳する' }));
    await screen.findByText('Groq に接続できません');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await screen.findByRole('button', { name: '習近平（しゅうきんぺい）の読みを直す' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
