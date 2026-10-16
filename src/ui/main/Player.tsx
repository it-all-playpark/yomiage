// 読み上げの操作（FR-3.2・FR-3.3）
import type { Speaker, SpeakerState } from '../../lib/speech';
import { settings, voices } from '../../state';

const RATES = [0.8, 1, 1.2, 1.5];

export function Player(props: { speaker: Speaker | null; state: SpeakerState; total: number; translating: boolean }) {
  const { speaker, state, total } = props;
  const active = state.playing && !state.paused;

  // live region（status）には状態の切り替わりだけを入れる。文ごとに変わる番号は外に出し、毎文の読み上げで TTS とぶつからないようにする
  let status = '停止中';
  let detail = '';
  if (!speaker) status = 'このブラウザは読み上げに対応していません';
  else if (state.paused) status = '一時停止中';
  else if (active && props.translating) {
    status = '受信しながら読み上げ中';
    detail = `（${total} 文が届いた）`;
  } else if (active) {
    status = '読み上げ中';
    if (state.sentence !== null) detail = `（${state.sentence + 1} / ${total} 文目）`;
  } else if (props.translating) status = '翻訳を受信中…';

  const progress = state.sentence !== null && total > 0 ? Math.round(((state.sentence + 1) / total) * 100) : 0;
  const s = settings.value;

  return (
    <div class="player">
      <div class="player-row">
        <button
          type="button"
          class="player-toggle"
          aria-label={active ? '一時停止' : '読み上げる'}
          disabled={!speaker || total === 0}
          onClick={() => (active ? speaker?.pause() : speaker?.play())}
        >
          {active ? (
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round">
              <path d="M8 5v14" />
              <path d="M16 5v14" />
            </svg>
          ) : (
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round">
              <path d="M7 4.5v15l12-7.5z" />
            </svg>
          )}
        </button>
        <div class="player-status">
          <div>
            <span role="status">{status}</span>
            {detail}
          </div>
          <div class="player-bar" aria-hidden="true">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div class="player-opts">
          <label for="voice">声</label>
          <select
            id="voice"
            class="select"
            value={s.voiceURI}
            disabled={!speaker}
            onChange={(e) => {
              settings.value = { ...settings.value, voiceURI: e.currentTarget.value };
            }}
          >
            <option value="">既定の声</option>
            {voices.value.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
                {v.localService ? '（PC 内蔵）' : ''}
              </option>
            ))}
          </select>
          <label for="rate">速さ</label>
          <select
            id="rate"
            class="select"
            value={String(s.rate)}
            disabled={!speaker}
            onChange={(e) => {
              settings.value = { ...settings.value, rate: Number(e.currentTarget.value) };
            }}
          >
            {RATES.map((r) => (
              <option key={r} value={String(r)}>
                {r.toFixed(1)}x
              </option>
            ))}
          </select>
        </div>
      </div>
      <span class="player-note">翻訳は 1 文ずつ届きます。1 文目が届いたら読み上げを始めます。</span>
    </div>
  );
}
