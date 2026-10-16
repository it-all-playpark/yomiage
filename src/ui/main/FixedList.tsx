// 「直した読み」一覧（FR-4.7）。ここから修正・辞書登録できる
import type { FixedWord } from '../../session';
import { SOURCE_LABEL } from './FixPanel';

export function FixedList(props: {
  items: FixedWord[];
  onEdit: (w: FixedWord) => void;
  onToDict: (w: FixedWord) => void;
}) {
  return (
    <section aria-labelledby="rd-h" class="card main-card main-fixed">
      <div class="main-head main-head--baseline">
        <h2 id="rd-h">直した読み</h2>
        <span class="main-sub">
          AI が付けた読みと、自分で直した読みの一覧です。辞書に入れると、次から同じ語は必ずこの読みになります。
        </span>
      </div>
      {props.items.length === 0 ? (
        <p class="main-sub">まだありません。</p>
      ) : (
        <ul class="fixed-grid">
          {props.items.map((w) => (
            <li key={w.word} class="fixed-item">
              <div class="fixed-word">
                <span class="fixed-text">{w.word}</span>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#556170" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
                <span class={w.fix === 'ai' ? 'fixed-reading tok-ai' : 'fixed-reading tok-fixed'}>{w.reading}</span>
              </div>
              <div class="fixed-foot">
                <span class="fixed-source">{SOURCE_LABEL[w.fix]}</span>
                <div class="fixed-actions">
                  <button type="button" class="btn" aria-label={`${w.word}の読みを直す`} onClick={() => props.onEdit(w)}>
                    直す
                  </button>
                  {w.fix === 'dict' ? (
                    <span class="fixed-indict">辞書に登録済み</span>
                  ) : (
                    <button
                      type="button"
                      class="btn btn-primary"
                      aria-label={`${w.word}を辞書に追加`}
                      onClick={() => props.onToDict(w)}
                    >
                      辞書に追加
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
