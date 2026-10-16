import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Setup } from './Setup';
import { apiKey, navigate, settings } from '../state';

vi.mock('../state', async () => {
  const { signal } = await import('@preact/signals');
  return {
    apiKey: signal<string | null>(null),
    settings: signal({ model: 'openai/gpt-oss-20b', voiceURI: '', rate: 1, showAllRuby: false }),
    navigate: vi.fn(),
  };
});

function okResponse(ids: string[]): Response {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
}

function typeKey(v: string) {
  fireEvent.input(screen.getByLabelText('Groq API key'), { target: { value: v } });
}

beforeEach(() => {
  apiKey.value = null;
  settings.value = { model: 'openai/gpt-oss-20b', voiceURI: '', rate: 1, showAllRuby: false };
  vi.mocked(navigate).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Setup', () => {
  it('3 ステップの案内と key の扱いの説明を出す', () => {
    render(<Setup />);
    expect(screen.getByText('Groq に無料で登録する')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'console.groq.com を開く' }).getAttribute('href')).toBe('https://console.groq.com');
    expect(screen.getByText('API Keys のページで key を作ってコピーする')).toBeTruthy();
    expect(screen.getByText('下に貼り付けて「接続をテスト」を押す')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'key の扱い' })).toBeTruthy();
  });

  it('登録済みの key を入力欄に出し、表示切替で type が変わる', () => {
    apiKey.value = 'gsk_saved';
    render(<Setup />);
    const input = screen.getByLabelText('Groq API key') as HTMLInputElement;
    expect(input.value).toBe('gsk_saved');
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'key を表示' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'key を隠す' }));
    expect(input.type).toBe('password');
  });

  it('接続テストに成功すると知らせを出し、key を保存する', async () => {
    const fetchMock = vi.fn(async () => okResponse(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']));
    vi.stubGlobal('fetch', fetchMock);
    render(<Setup />);
    typeKey('  gsk_new  ');
    fireEvent.click(screen.getByRole('button', { name: '接続をテスト' }));
    await screen.findByText('接続できました。この key で翻訳できます。');
    expect(apiKey.value).toBe('gsk_new');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_new');
  });

  it('401 なら key が使えないと出し、保存しない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    render(<Setup />);
    typeKey('gsk_bad');
    fireEvent.click(screen.getByRole('button', { name: '接続をテスト' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('key が使えません');
    expect(apiKey.value).toBeNull();
  });

  it('選んだモデルが /models に無ければ知らせる', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(['some-other-model'])));
    render(<Setup />);
    typeKey('gsk_x');
    fireEvent.click(screen.getByRole('button', { name: '接続をテスト' }));
    await screen.findByText('接続できました。この key で翻訳できます。');
    expect(screen.getByRole('alert').textContent).toContain('openai/gpt-oss-20b が使えない');
  });

  it('key が空のうちは接続テストと保存を押せない', () => {
    render(<Setup />);
    expect((screen.getByRole('button', { name: '接続をテスト' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '保存してはじめる' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('モデルを選ぶと設定に入る。速さ重視がおすすめ', () => {
    render(<Setup />);
    const select = screen.getByLabelText('翻訳に使うモデル') as HTMLSelectElement;
    expect(select.value).toBe('openai/gpt-oss-20b');
    expect(select.options[0].textContent).toContain('おすすめ');
    fireEvent.change(select, { target: { value: 'openai/gpt-oss-120b' } });
    expect(settings.value.model).toBe('openai/gpt-oss-120b');
  });

  it('「保存してはじめる」で key を保存して翻訳画面へ移る', () => {
    render(<Setup />);
    typeKey('gsk_go');
    fireEvent.click(screen.getByRole('button', { name: '保存してはじめる' }));
    expect(apiKey.value).toBe('gsk_go');
    expect(navigate).toHaveBeenCalledWith('#/');
  });

  it('「このブラウザから key を削除」で key を消し、入力欄も空にする', async () => {
    apiKey.value = 'gsk_saved';
    render(<Setup />);
    fireEvent.click(screen.getByRole('button', { name: 'このブラウザから key を削除' }));
    expect(apiKey.value).toBeNull();
    await waitFor(() => expect((screen.getByLabelText('Groq API key') as HTMLInputElement).value).toBe(''));
    expect(screen.getByText('このブラウザから key を削除しました。')).toBeTruthy();
  });
});
