import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 画面本体は別担当なので、どの画面が出たかだけ分かる置き換えにする
vi.mock('./ui/Setup', () => ({ Setup: () => <p>setup-screen</p> }));
vi.mock('./ui/Dictionary', () => ({ Dictionary: () => <p>dict-screen</p> }));
vi.mock('./ui/Main', () => ({ Main: () => <p>main-screen</p> }));

async function load() {
  vi.resetModules();
  const state = await import('./state');
  const { App } = await import('./app');
  return { state, App };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('route に応じて画面を切り替え、メニューの現在地を示す', async () => {
    localStorage.setItem('yomiage.groqKey', 'gsk_x');
    const { state, App } = await load();
    render(<App />);
    expect(screen.getByText('main-screen')).toBeTruthy();
    expect(screen.getByRole('link', { name: '翻訳' }).getAttribute('aria-current')).toBe('page');

    act(() => state.navigate('#/dict'));
    expect(screen.getByText('dict-screen')).toBeTruthy();
    expect(screen.getByRole('link', { name: '読み辞書' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: '翻訳' }).getAttribute('aria-current')).toBeNull();

    act(() => state.navigate('#/setup'));
    expect(screen.getByText('setup-screen')).toBeTruthy();
  });

  it('key の有無をヘッダーに出す', async () => {
    const { state, App } = await load();
    render(<App />);
    expect(screen.getByText('key 未登録')).toBeTruthy();
    act(() => {
      state.apiKey.value = 'gsk_x';
    });
    expect(screen.getByText('Groq key 登録済み')).toBeTruthy();
  });

  it('メニューのリンクはハッシュを指す', async () => {
    const { App } = await load();
    render(<App />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#/', '#/dict', '#/setup']);
  });

  it('保存できる環境ではバナーを出さない', async () => {
    const { App } = await load();
    render(<App />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('localStorage が使えなければ保存できないことをバナーで知らせる', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { App } = await load();
    render(<App />);
    expect(screen.getByRole('status').textContent).toContain('保存ができません');
  });
});
