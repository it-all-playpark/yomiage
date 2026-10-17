// 読み上げ（spec §6）。1 文 1 発話で speechSynthesis に積む。
// 合成側に積むのは常に 1 発話だけにし、読み終えてから次の文を積む。
// macOS の Chrome は speak した発話が始まらないまま speaking で止まることがある（声・速さ・積み方によらない）。
// cancel して同じ文を積み直すとそこから読み続けるので、一定時間始まらなければ積み直す
import type { SpeechText } from '../types';
import { tokenAtCharIndex } from './speechText';

// 積んでからこの時間 start も end も来なければ、止まったとみなして積み直す。
// 読み始めが遅いだけの声（オンライン音声など）を飛ばさないよう、積み直すたびにこの時間ずつ延ばす
export const START_TIMEOUT_MS = 2000;
// 1 文を積み直す回数の上限。超えたら読み終えた扱いで次の文へ進む
export const MAX_RESTARTS = 2;

export interface SpeakerState {
  playing: boolean;
  paused: boolean;
  sentence: number | null;
  tokenId: number | null;
  boundarySupported: boolean;
}

/** lang が ja で始まる声 */
export function japaneseVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  return synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ja'));
}

export class Speaker {
  private sentences = new Map<number, SpeechText>();
  private voiceURI = '';
  private rate = 1;
  private state: SpeakerState = {
    playing: false,
    paused: false,
    sentence: null,
    tokenId: null,
    boundarySupported: false,
  };
  private listeners = new Set<(s: SpeakerState) => void>();
  // cancel 後に古い発話から届くイベントを捨てるための世代番号
  private gen = 0;
  // 今の文を読み終えたら次に積む文番号
  private next = 0;
  // 読み終えて次の文を待っている（届いたら続けて読む）
  private following = false;
  // 今読んでいる（読み始める）文
  private head = 0;
  // 一時停止扱いで止めている文。合成側には何も積んでおらず、play でここから読む
  private parked: number | null = null;
  // 試聴が終わったら本編をどうするか（試聴中だけ持つ）
  private afterPreview: 'resume' | 'follow' | null = null;
  // 積んだ発話を読み終えるまで持っておく（参照が切れると onend が来ないブラウザがある）
  private live = new Set<SpeechSynthesisUtterance>();
  // 積んだ発話が始まるかの見張り。一時停止で止め、再開したら待ち時間を最初から張り直す
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private startWatch: (() => void) | null = null;

  constructor(
    private synth: SpeechSynthesis,
    private makeUtterance: (text: string) => SpeechSynthesisUtterance = (text) =>
      new SpeechSynthesisUtterance(text),
  ) {}

  setVoice(voiceURI: string): void {
    const changed = voiceURI !== this.voiceURI;
    this.voiceURI = voiceURI;
    // 声が変われば boundary が来るかも変わる
    this.update({ boundarySupported: false, tokenId: null });
    if (changed) this.respeakCurrent();
  }

  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    this.respeakCurrent();
  }

  setSentence(index: number, st: SpeechText): void {
    this.sentences.set(index, st);
    // 読み上げ中に届いた文は、今の文を読み終えたとき積む
    if (this.following && index === this.next) {
      this.following = false;
      this.update({ playing: true });
      this.speakNext(this.gen);
    }
  }

  play(): void {
    if (this.parked !== null) {
      this.startFrom(this.parked);
      return;
    }
    if (this.state.paused) {
      this.synth.resume();
      this.update({ paused: false });
      this.startWatch?.();
      return;
    }
    if (!this.state.playing) this.startFrom(0);
  }

  pause(): void {
    if (!this.state.playing || this.state.paused) return;
    this.synth.pause();
    // 一時停止中は始まらなくて当たり前なので見張らない
    clearTimeout(this.watchTimer);
    this.update({ paused: true });
  }

  restart(): void {
    this.startFrom(0);
  }

  /** 止めて登録済みの文も捨てる（新しい翻訳を始めるとき） */
  stop(): void {
    this.halt();
    this.sentences.clear();
    this.next = 0;
  }

  /** 読み上げ中ならその文から読み直す。一時停止中は再開せず、再開したときその文から読む */
  respeakFrom(index: number): void {
    if (!this.state.playing || !this.sentences.has(index)) return;
    if (this.parked !== null) this.park(index);
    else if (this.state.paused) {
      this.halt();
      this.park(index);
    } else this.startFrom(index);
  }

  /** 本編を一時停止扱いにして試聴し、終わったら元の状態に戻す（読み上げ中なら今の文から読み直す） */
  preview(text: string): void {
    const at = this.state.playing ? (this.parked ?? this.head) : null;
    // 試聴中にもう一度試聴したときは、最初の試聴の前の状態を引き継ぐ
    const after =
      this.afterPreview ?? (this.state.playing && !this.state.paused ? 'resume' : this.following ? 'follow' : null);
    this.halt();
    if (at !== null) this.park(at);
    this.afterPreview = after;
    const gen = this.gen;
    const u = this.makeUtterance(text);
    this.applyVoice(u);
    u.onend = u.onerror = () => {
      this.live.delete(u);
      if (gen !== this.gen) return;
      const a = this.afterPreview;
      this.afterPreview = null;
      if (a === 'resume' && this.parked !== null) this.startFrom(this.parked);
      else if (a === 'follow') {
        if (this.sentences.has(this.next)) this.startFrom(this.next);
        else this.following = true;
      }
    };
    this.speak(u);
  }

  onState(cb: (s: SpeakerState) => void): () => void {
    this.listeners.add(cb);
    cb({ ...this.state });
    return () => {
      this.listeners.delete(cb);
    };
  }

  // 積み済みの発話には声・速さが効かないので、今の文から積み直す。一時停止扱い中は play で parked から読むので何もしない
  private respeakCurrent(): void {
    if (!this.state.playing || this.parked !== null) return;
    if (this.state.paused) {
      this.halt();
      this.park(this.head);
    } else this.startFrom(this.head);
  }

  private startFrom(index: number): void {
    this.halt();
    if (!this.sentences.has(index)) return;
    this.next = index;
    this.head = index;
    this.update({ playing: true });
    this.speakNext(this.gen);
  }

  // 発話を全部取り消して止まった状態にする
  private halt(): void {
    this.gen++;
    this.following = false;
    this.parked = null;
    this.afterPreview = null;
    this.synth.cancel();
    this.live.clear();
    // 一時停止中に cancel しても paused のまま残るブラウザがある
    if (this.state.paused) this.synth.resume();
    this.update({ playing: false, paused: false, sentence: null, tokenId: null });
  }

  private park(index: number): void {
    this.parked = index;
    this.next = index;
    this.update({ playing: true, paused: true, sentence: index, tokenId: null });
  }

  private speak(u: SpeechSynthesisUtterance): void {
    this.live.add(u);
    this.synth.speak(u);
  }

  // next の文を 1 発話だけ積む。読み終えたら、次の文が届いていれば続けて積む
  private speakNext(gen: number, restarts = 0): void {
    const index = this.next++;
    const st = this.sentences.get(index)!;
    const u = this.makeUtterance(st.text);
    this.applyVoice(u);
    // start も end もまだ来ていない
    let waiting = true;
    u.onstart = () => {
      waiting = false;
      if (gen !== this.gen) return;
      this.head = index;
      this.update({ sentence: index, tokenId: null });
    };
    u.onboundary = (e) => {
      if (gen !== this.gen || e.name === 'sentence') return;
      // 積んだ後にトークンを作り直していれば id が変わっているので、今の対応表を使う。文が変わっていれば語は特定しない
      const cur = this.sentences.get(index);
      const tokenId = cur && cur.text === st.text ? tokenAtCharIndex(cur, e.charIndex) : null;
      this.update({ boundarySupported: true, tokenId });
    };
    const done = (g: number) => {
      if (this.sentences.has(this.next)) {
        this.speakNext(g);
        return;
      }
      // 届いている文を読み終えた。次の文が届けば続ける
      this.following = true;
      this.update({ playing: false, paused: false, sentence: null, tokenId: null });
    };
    // 合成に失敗した発話も onerror で終わる扱いにする
    u.onend = u.onerror = () => {
      waiting = false;
      this.live.delete(u);
      if (gen !== this.gen) return;
      done(gen);
    };
    const timeout = START_TIMEOUT_MS * (restarts + 1);
    const watch = () => {
      if (!waiting || gen !== this.gen) return;
      // 始まらずに止まっている。取り消し、古い発話のイベントは世代番号で捨てる
      this.gen++;
      this.synth.cancel();
      this.live.clear();
      if (restarts < MAX_RESTARTS) {
        this.next = index;
        this.speakNext(this.gen, restarts + 1);
      } else done(this.gen);
    };
    this.speak(u);
    this.startWatch = () => {
      clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(watch, timeout);
    };
    this.startWatch();
  }

  private applyVoice(u: SpeechSynthesisUtterance): void {
    u.lang = 'ja-JP';
    u.rate = this.rate;
    const voice = this.synth.getVoices().find((v) => v.voiceURI === this.voiceURI);
    if (voice) u.voice = voice;
  }

  private update(patch: Partial<SpeakerState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb({ ...this.state });
  }
}
