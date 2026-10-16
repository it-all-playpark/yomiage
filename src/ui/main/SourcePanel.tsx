// 原文の入力（FR-2.1・FR-2.2）
import { MODELS } from '../../lib/groq';
import { settings } from '../../state';
import { sourceLang, sourceText, translating } from '../../session';

// 値はそのままプロンプトの「原文の言語」に入る
const LANGS: { value: string; label: string }[] = [
  { value: 'auto', label: '自動検出' },
  { value: '英語', label: '英語' },
  { value: '中国語', label: '中国語' },
  { value: '韓国語', label: '韓国語' },
  { value: 'フランス語', label: 'フランス語' },
  { value: 'ドイツ語', label: 'ドイツ語' },
  { value: 'スペイン語', label: 'スペイン語' },
];

export function SourcePanel({ onTranslate, canTranslate }: { onTranslate: () => void; canTranslate: boolean }) {
  const model = MODELS.find((m) => m.id === settings.value.model);
  const modelLabel = model ? `${model.id}（${model.label}）` : settings.value.model;

  return (
    <section aria-labelledby="src-h" class="card main-card main-src">
      <div class="main-head">
        <h2 id="src-h">原文</h2>
        <div class="main-lang">
          <label for="src-lang" class="visually-hidden">
            原文の言語
          </label>
          <select
            id="src-lang"
            class="select"
            value={sourceLang.value}
            onChange={(e) => {
              sourceLang.value = e.currentTarget.value;
            }}
          >
            {LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#556170" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
          <span class="main-lang-to">日本語</span>
        </div>
      </div>
      <label for="src-text" class="visually-hidden">
        翻訳する文章
      </label>
      <textarea
        id="src-text"
        class="main-textarea"
        rows={11}
        value={sourceText.value}
        onInput={(e) => {
          sourceText.value = e.currentTarget.value;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (canTranslate) onTranslate();
          }
        }}
      />
      <div class="main-src-foot">
        <div class="main-src-hint">
          <span>Ctrl + Enter でも翻訳できます</span>
          <a href="#/setup">モデル：{modelLabel}</a>
        </div>
        <button type="button" class="btn btn-primary main-translate" onClick={onTranslate} disabled={!canTranslate}>
          {/* 翻訳中に押すと前回を止めてやり直す */}
          {translating.value ? '翻訳中…' : '翻訳する'}
        </button>
      </div>
    </section>
  );
}
