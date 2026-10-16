// 読み辞書（FR-5）。追加・試聴・一覧・絞り込み・編集・削除・書き出し・読み込み
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DictEntry } from '../types';
import { exportDict, importDict, isHiragana, removeEntry, upsertEntry } from '../lib/storage';
import { hasKanji } from '../lib/analyzer';
import { dict, speaker } from '../state';
import '../styles/dictionary.css';

const SOURCE_LABEL: Record<DictEntry['source'], string> = {
  manual: '手入力',
  translation: '翻訳画面から',
};

const READING_ERROR = '読みはひらがなで入力してください。';

function preview(text: string): void {
  speaker?.preview(text);
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  );
}

export function Dictionary() {
  const [word, setWord] = useState('');
  const [reading, setReading] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ word: string; reading: string; error: string | null } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  // 操作で押したボタンが消えるとき、次にフォーカスを移す先（data-focus の値）。描画後に移す（NFR-6）
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const k = focusNext.current;
    if (k === null) return;
    focusNext.current = null;
    const els = rootRef.current?.querySelectorAll<HTMLElement>('[data-focus]') ?? [];
    for (const el of els) {
      if (el.dataset.focus === k) {
        el.focus();
        return;
      }
    }
  });

  const entries = dict.value.entries;
  const query = q.trim();
  const rows = query === '' ? entries : entries.filter((e) => e.word.includes(query) || e.reading.includes(query));
  const canPreview = speaker !== null;

  function add() {
    const w = word.trim();
    const r = reading.trim();
    if (w === '') {
      setAddError('単語を入力してください。');
      return;
    }
    // 読みを固定できるのは漢字を含む語だけ（§4.2）。登録しても効かない語は断る
    if (!hasKanji(w)) {
      setAddError('漢字を含む単語を入力してください。');
      return;
    }
    if (!isHiragana(r)) {
      setAddError(READING_ERROR);
      return;
    }
    dict.value = upsertEntry(dict.value, { word: w, reading: r, source: 'manual' });
    setWord('');
    setReading('');
    setAddError(null);
    setMessage({ ok: true, text: `「${w}」を登録しました。` });
  }

  function saveEdit() {
    if (editing === null) return;
    const r = editing.reading.trim();
    if (!isHiragana(r)) {
      setEditing({ ...editing, error: READING_ERROR });
      return;
    }
    const cur = entries.find((e) => e.word === editing.word);
    if (cur) dict.value = upsertEntry(dict.value, { word: cur.word, reading: r, source: cur.source });
    stopEdit();
  }

  function startEdit(e: DictEntry) {
    focusNext.current = `input:${e.word}`;
    setEditing({ word: e.word, reading: e.reading, error: null });
  }

  function stopEdit() {
    if (editing !== null) focusNext.current = `edit:${editing.word}`;
    setEditing(null);
  }

  function remove(w: string) {
    // 消した行の次（無ければ前）の行の削除ボタンへ。行が無くなれば単語の入力欄へ
    const k = rows.findIndex((e) => e.word === w);
    const near = rows[k + 1] ?? rows[k - 1];
    focusNext.current = near ? `del:${near.word}` : 'word';
    dict.value = removeEntry(dict.value, w);
    if (editing?.word === w) setEditing(null);
    setMessage({ ok: true, text: `「${w}」を削除しました。` });
  }

  function download() {
    const blob = new Blob([exportDict(dict.value)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'yomiage-dict.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function load(file: File) {
    const r = importDict(dict.value, await file.text());
    if (r.ok) {
      dict.value = r.dict;
      setMessage({ ok: true, text: `${r.count} 件を読み込みました。` });
    } else {
      setMessage({ ok: false, text: `読み込めませんでした：${r.error}` });
    }
  }

  return (
    <main class="dict" ref={rootRef}>
      <div class="dict-head">
        <div class="dict-title">
          <h1>読み辞書</h1>
          <p>ここに登録した読みは、AI が付ける読みより優先されます。</p>
        </div>
        <div class="dict-io">
          <button type="button" class="dict-btn" onClick={download}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 15V3" />
              <path d="m7 10 5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
            書き出し
          </button>
          <button type="button" class="dict-btn" onClick={() => fileRef.current?.click()}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v12" />
              <path d="m7 8 5-5 5 5" />
              <path d="M4 21h16" />
            </svg>
            読み込み
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="dict-file"
            aria-label="辞書ファイルを読み込む"
            tabIndex={-1}
            onChange={(e) => {
              const input = e.currentTarget;
              const f = input.files?.[0];
              // 同じファイルを続けて選べるよう空に戻す
              input.value = '';
              if (f) void load(f);
            }}
          />
        </div>
      </div>

      {message && (
        <p role={message.ok ? 'status' : 'alert'} class={message.ok ? 'dict-ok' : 'dict-error'}>
          {message.text}
        </p>
      )}

      <section aria-labelledby="add-h" class="dict-card">
        <h2 id="add-h">読みを追加</h2>
        <form
          class="dict-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div class="dict-field">
            <label for="dict-w">単語</label>
            <input id="dict-w" data-focus="word" type="text" placeholder="例：御用達" value={word} onInput={(e) => setWord(e.currentTarget.value)} />
          </div>
          <div class="dict-field">
            <label for="dict-r">読み（ひらがな）</label>
            <input
              id="dict-r"
              type="text"
              placeholder="例：ごようたし"
              value={reading}
              aria-invalid={addError === READING_ERROR}
              aria-describedby={addError ? 'dict-add-error' : undefined}
              onInput={(e) => setReading(e.currentTarget.value)}
            />
          </div>
          <button
            type="button"
            class="dict-btn dict-btn-outline"
            disabled={!canPreview || reading.trim() === ''}
            onClick={() => preview(reading.trim())}
          >
            <PlayIcon />
            試聴
          </button>
          <button type="submit" class="dict-btn dict-btn-primary">
            追加
          </button>
        </form>
        {addError && (
          <p id="dict-add-error" role="alert" class="dict-error">
            {addError}
          </p>
        )}
        {!canPreview && <p class="dict-note">このブラウザでは読み上げが使えないため、試聴できません。</p>}
      </section>

      <section aria-labelledby="list-h" class="dict-card">
        <div class="dict-list-head">
          <h2 id="list-h">
            登録済み <span class="dict-count">{entries.length} 件</span>
          </h2>
          <div class="dict-filter">
            <label for="dict-q">絞り込み</label>
            <input id="dict-q" type="search" placeholder="単語か読みで検索" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          </div>
        </div>

        {entries.length === 0 ? (
          <p class="dict-note">まだ登録はありません。</p>
        ) : rows.length === 0 ? (
          <p class="dict-note">「{query}」に当てはまる語はありません。</p>
        ) : (
          <div class="dict-table-wrap">
            <table class="dict-table">
              <thead>
                <tr>
                  <th scope="col">単語</th>
                  <th scope="col">読み</th>
                  <th scope="col">登録元</th>
                  <th scope="col" class="dict-ops-h">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const isEditing = editing?.word === e.word;
                  return (
                    <tr key={e.word}>
                      <td class="dict-word">{e.word}</td>
                      <td class="dict-reading">
                        {isEditing ? (
                          <div class="dict-edit">
                            <input
                              type="text"
                              data-focus={`input:${e.word}`}
                              aria-label={`${e.word} の読み`}
                              value={editing.reading}
                              aria-invalid={editing.error !== null}
                              onInput={(ev) => setEditing({ ...editing, reading: ev.currentTarget.value, error: null })}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter') saveEdit();
                                if (ev.key === 'Escape') stopEdit();
                              }}
                            />
                            {editing.error && (
                              <span role="alert" class="dict-error-inline">
                                {editing.error}
                              </span>
                            )}
                          </div>
                        ) : (
                          e.reading
                        )}
                      </td>
                      <td>
                        <span class="dict-source">{SOURCE_LABEL[e.source]}</span>
                      </td>
                      <td>
                        <div class="dict-ops">
                          <button
                            type="button"
                            class="dict-icon dict-icon-play"
                            aria-label={`${e.word} を試聴`}
                            disabled={!canPreview}
                            onClick={() => preview(isEditing ? editing.reading.trim() : e.reading)}
                          >
                            <PlayIcon />
                          </button>
                          {isEditing ? (
                            <>
                              <button type="button" class="dict-text-btn dict-text-btn-primary" onClick={saveEdit}>
                                保存
                              </button>
                              <button type="button" class="dict-text-btn" onClick={stopEdit}>
                                やめる
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              class="dict-icon"
                              data-focus={`edit:${e.word}`}
                              aria-label={`${e.word} を編集`}
                              onClick={() => startEdit(e)}
                            >
                              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                              </svg>
                            </button>
                          )}
                          <button
                            type="button"
                            class="dict-icon dict-icon-danger"
                            data-focus={`del:${e.word}`}
                            aria-label={`${e.word} を削除`} onClick={() => remove(e.word)}>
                            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M4 7h16" />
                              <path d="M9 7V4h6v3" />
                              <path d="M6 7l1 13h10l1-13" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p class="dict-note">
          辞書はこのブラウザに保存されます。別のパソコンに移すときは「書き出し」したファイルを、移った先で「読み込み」してください。
        </p>
      </section>
    </main>
  );
}
