// 訳文のトークン表示（§4.3）。漢字の語はクリックで修正パネルを開く（FR-4.3）。それ以外をクリックするとその文から読む
import type { Token } from '../../types';
import type { SpeakerState } from '../../lib/speech';
import { hasKanji } from '../../lib/analyzer';
import type { SessionSentence, View } from '../../session';

export function TokenText(props: {
  sentences: SessionSentence[];
  view: View;
  showAllRuby: boolean;
  speaking: SpeakerState;
  selectedId: number | null;
  receiving: boolean;
  onPick: (sentence: number, token: Token) => void;
  onPlayFrom: (sentence: number) => void;
}) {
  const { view, showAllRuby, speaking, selectedId } = props;
  const kana = view === 'kana';

  // 原文の段落ごとに 1 つの <p> にまとめる（文は段落順に届く）
  const paragraphs: SessionSentence[][] = [];
  for (const s of props.sentences) {
    const last = paragraphs.at(-1);
    if (last && last[0].p === s.p) last.push(s);
    else paragraphs.push([s]);
  }

  const sentence = (s: SessionSentence) => {
        const current = speaking.sentence === s.i;
        // boundary が来ない声では文全体をハイライト（§6）
        const wholeSentence = current && (!speaking.boundarySupported || speaking.tokenId === null);
        return (
          <span
            key={s.i}
            class={wholeSentence ? 'main-sent is-speaking' : 'main-sent'}
            data-sentence={s.i}
            onClick={(e) => {
              // 語のクリックは修正パネル、ドラッグで文字を選んだとき（コピーなど）は読み始めない
              if ((e.target as Element).closest('.tok-word')) return;
              if (!(window.getSelection()?.isCollapsed ?? true)) return;
              props.onPlayFrom(s.i);
            }}
          >
            {s.tokens.map((t) => {
              const fixed = t.fix !== 'none' && t.reading !== null;
              const cls = [
                'tok',
                fixed ? `tok-${t.fix === 'ai' ? 'ai' : 'fixed'}` : '',
                current && !wholeSentence && speaking.tokenId === t.id ? 'is-speaking' : '',
                selectedId === t.id ? 'is-selected' : '',
                kana && fixed ? 'is-kana' : '',
              ]
                .filter(Boolean)
                .join(' ');
              // 読み上げ用は音声に渡す文（§5）：直した語だけかな
              const shown = kana && fixed ? t.reading! : t.text;
              if (!hasKanji(t.text)) {
                return (
                  <span key={t.id} class={cls}>
                    {t.text}
                  </span>
                );
              }
              const ruby = !kana && t.reading !== null && (fixed || showAllRuby);
              return (
                <button
                  key={t.id}
                  type="button"
                  class={`${cls} tok-word`}
                  data-start={t.start}
                  aria-label={`${t.text}（${t.reading ?? '読み未取得'}）の読みを直す`}
                  aria-pressed={selectedId === t.id}
                  onClick={() => props.onPick(s.i, t)}
                >
                  {ruby ? (
                    <ruby>
                      {shown}
                      <rt>{t.reading}</rt>
                    </ruby>
                  ) : (
                    shown
                  )}
                </button>
              );
            })}
          </span>
        );
  };

  return (
    <div class="main-text" lang="ja">
      {paragraphs.map((group, k) => (
        <p key={group[0].p} class="main-para">
          {group.map(sentence)}
          {props.receiving && k === paragraphs.length - 1 && <span class="main-receiving">次の文を受信中…</span>}
        </p>
      ))}
      {props.receiving && paragraphs.length === 0 && (
        <p class="main-para">
          <span class="main-receiving">次の文を受信中…</span>
        </p>
      )}
    </div>
  );
}
