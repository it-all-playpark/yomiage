// 語の読みを直すパネル（FR-4.4・FR-4.5）
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Fix, Token } from '../../types';
import { katakanaToHiragana } from '../../lib/analyzer';
import { isHiragana } from '../../lib/storage';

export const SOURCE_LABEL: Record<Fix, string> = {
  none: '自動解析の読み',
  ai: 'AI が付けた読み',
  once: 'この文だけ直した読み',
  dict: '辞書の読み',
};

export function FixPanel(props: {
  token: Token;
  onPreview: (reading: string) => void;
  onSave: (reading: string, target: 'once' | 'dict') => void;
  onCancel: () => void;
}) {
  const { token } = props;
  const [draft, setDraft] = useState(token.reading ?? '');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(token);
  latest.current = token;

  // 別の語を選び直したら下書きを入れ替えて入力欄へ。作り直しで id だけ変わったときは下書きを残す
  useEffect(() => {
    setDraft(token.reading ?? '');
    setInvalid(false);
    input.current?.focus();
  }, [token.sentence, token.start, token.text]);

  // 閉じたら選んでいた語のボタンへフォーカスを戻す（NFR-6）
  useEffect(
    () => () => {
      const t = latest.current;
      document.querySelector<HTMLElement>(`[data-sentence="${t.sentence}"] [data-start="${t.start}"]`)?.focus();
    },
    [],
  );

  const reading = katakanaToHiragana(draft.trim());
  const save = (target: 'once' | 'dict') => {
    if (!isHiragana(reading)) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    props.onSave(reading, target);
  };
  // 辞書の語は辞書が優先される（§4.1）ので、この文だけ直しても変わらない
  const onceDisabled = token.fix === 'dict';

  return (
    <div
      role="dialog"
      aria-labelledby="fix-h"
      class="fix-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onCancel();
      }}
    >
      <div class="fix-head">
        <span id="fix-h" class="fix-title">
          「{token.text}」の読みを直す
        </span>
        <span class="fix-current">
          今の読み：{token.reading ?? '（まだありません）'}（{SOURCE_LABEL[token.fix]}）
        </span>
      </div>
      <div class="fix-row">
        <div class="fix-field">
          <label for="fix-reading">読み（ひらがな）</label>
          <input
            id="fix-reading"
            ref={input}
            type="text"
            class="input"
            value={draft}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'fix-err' : undefined}
            onInput={(e) => {
              setDraft(e.currentTarget.value);
              setInvalid(false);
            }}
          />
        </div>
        <button type="button" class="btn fix-preview" disabled={reading === ''} onClick={() => props.onPreview(reading)}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4.5v15l12-7.5z" />
          </svg>
          試聴
        </button>
      </div>
      {invalid && (
        <p id="fix-err" role="alert" class="fix-err">
          読みはひらがなで入力してください
        </p>
      )}
      {onceDisabled && <p class="fix-note">辞書の語です。直すと辞書の読みが変わります。</p>}
      <div class="fix-actions">
        <button type="button" class="btn fix-cancel" onClick={props.onCancel}>
          キャンセル
        </button>
        {!onceDisabled && (
          <button type="button" class="btn fix-once" onClick={() => save('once')}>
            この文だけ直す
          </button>
        )}
        <button type="button" class="btn btn-primary" onClick={() => save('dict')}>
          辞書に登録して直す
        </button>
      </div>
    </div>
  );
}
