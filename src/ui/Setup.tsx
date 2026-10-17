// 初回設定（FR-1）。Groq API key の登録・接続テスト・削除とモデル選択
import { useState } from 'preact/hooks';
import type { GroqError } from '../types';
import { MODELS, testConnection } from '../lib/groq';
import { apiKey, navigate, rememberKey, settings } from '../state';
import '../styles/setup.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; models: string[] }
  | { kind: 'error'; error: GroqError };

export function Setup() {
  const [input, setInput] = useState(apiKey.value ?? '');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [removed, setRemoved] = useState(false);

  const key = input.trim();
  const model = settings.value.model;

  async function test() {
    if (key === '') return;
    setStatus({ kind: 'testing' });
    const r = await testConnection(key);
    if (r.ok) {
      // 使えると分かった key はその場で保存する（保存は state 側の effect）
      apiKey.value = key;
      setStatus({ kind: 'ok', models: r.models });
    } else {
      setStatus({ kind: 'error', error: r.error });
    }
  }

  function remove() {
    apiKey.value = null;
    setInput('');
    setStatus({ kind: 'idle' });
    setRemoved(true);
  }

  function start() {
    if (key === '') return;
    apiKey.value = key;
    navigate('#/');
  }

  // 接続できたのに選んだモデルが一覧に無いとき（§9 V6）
  const modelMissing = status.kind === 'ok' && status.models.length > 0 && !status.models.includes(model);

  return (
    <main class="setup">
      <section aria-labelledby="setup-h" class="setup-card setup-main">
        <div class="setup-intro">
          <h1 id="setup-h">はじめに、Groq の API key を登録します</h1>
          <p>翻訳と読みの付与に Groq を使います。key は一度登録すれば、次からは文章を貼ってボタンを押すだけです。</p>
        </div>

        <ol class="setup-steps">
          <li>
            <span aria-hidden="true" class="setup-num">1</span>
            <div>
              <span class="setup-step-title">Groq に無料で登録する</span>
              <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer">
                console.groq.com を開く
              </a>
            </div>
          </li>
          <li>
            <span aria-hidden="true" class="setup-num">2</span>
            <div>
              <span class="setup-step-title">API Keys のページで key を作ってコピーする</span>
              <span class="setup-sub">「gsk_」で始まる文字列です。</span>
            </div>
          </li>
          <li>
            <span aria-hidden="true" class="setup-num">3</span>
            <div>
              <span class="setup-step-title">下に貼り付けて「接続をテスト」を押す</span>
            </div>
          </li>
        </ol>

        <div class="setup-field">
          <label for="api-key">Groq API key</label>
          <div class="setup-key-row">
            <input
              id="api-key"
              // preact の型は type ごとに分かれていて和集合を受けないので片方に寄せる
              type={(show ? 'text' : 'password') as 'text'}
              placeholder="gsk_..."
              autocomplete="off"
              spellcheck={false}
              value={input}
              onInput={(e) => {
                setInput(e.currentTarget.value);
                setStatus({ kind: 'idle' });
                setRemoved(false);
              }}
            />
            <button
              type="button"
              class="setup-eye"
              aria-label={show ? 'key を隠す' : 'key を表示'}
              aria-pressed={show}
              onClick={() => setShow(!show)}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <button
              type="button"
              class="setup-btn setup-btn-outline"
              disabled={key === '' || status.kind === 'testing'}
              onClick={test}
            >
              {status.kind === 'testing' ? 'テスト中…' : '接続をテスト'}
            </button>
          </div>
          {status.kind === 'ok' && (
            <div role="status" class="setup-ok">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m5 12 5 5 9-10" />
              </svg>
              接続できました。この key で翻訳できます。
            </div>
          )}
          {status.kind === 'error' && (
            <div role="alert" class="setup-error">
              {status.error.message}
            </div>
          )}
          {removed && (
            <div role="status" class="setup-sub">
              このブラウザから key を削除しました。
            </div>
          )}
          <label class="setup-check">
            <input
              type="checkbox"
              checked={rememberKey.value}
              onChange={(e) => {
                rememberKey.value = e.currentTarget.checked;
              }}
            />
            このブラウザに key を覚えておく
          </label>
          <span class="setup-sub">外すと、このタブを閉じたときに key を消します。次に使うときは貼り直してください。</span>
        </div>

        <div class="setup-field">
          <label for="model">翻訳に使うモデル</label>
          <select
            id="model"
            value={model}
            onChange={(e) => {
              settings.value = { ...settings.value, model: e.currentTarget.value };
            }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}（{m.label}{m.recommended ? '・おすすめ' : ''}）
              </option>
            ))}
          </select>
          <span class="setup-sub">
            速さ重視は、ボタンを押してから声が出るまでが短くなります。訳の質が気になるときだけ精度重視にしてください。
          </span>
          {modelMissing && (
            <span role="alert" class="setup-error">
              この key では {model} が使えないようです。別のモデルを選んでください。
            </span>
          )}
        </div>

        <div class="setup-actions">
          <button type="button" class="setup-btn setup-btn-danger" disabled={apiKey.value === null} onClick={remove}>
            このブラウザから key を削除
          </button>
          <button type="button" class="setup-btn setup-btn-primary" disabled={key === ''} onClick={start}>
            保存してはじめる
          </button>
        </div>
      </section>

      <aside aria-labelledby="privacy-h" class="setup-card setup-aside">
        <div class="setup-aside-head">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2F4BD8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <h2 id="privacy-h">key の扱い</h2>
        </div>
        <ul>
          <li>key はこのブラウザの中にだけ保存されます。</li>
          <li>文章と key は Groq に直接送られます。このアプリの開発者のサーバーは通りません。</li>
          <li>料金は登録した Groq アカウントの無料枠の範囲です。上限は Groq の画面で確認できます。</li>
          <li>共有のパソコンでは「このブラウザに key を覚えておく」を外すか、終わったら key を削除してください。</li>
          <li>Groq の画面で使用量の上限を決めておくと、key が漏れたときの被害を抑えられます。</li>
        </ul>
      </aside>
    </main>
  );
}
