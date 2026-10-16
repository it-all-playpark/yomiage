// 読み上げ（spec §6）。1 文 1 発話で speechSynthesis に積む
import type { SpeechText } from '../types';
import { tokenAtCharIndex } from './speechText';

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
  // 次に積む文番号
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

  constructor(
    private synth: SpeechSynthesis,
    private makeUtterance: (text: string) => SpeechSynthesisUtterance = (text) =>
      new SpeechSynthesisUtterance(text),
  ) {}

  setVoice(voiceURI: string): void {
    this.voiceURI = voiceURI;
    // 声が変われば boundary が来るかも変わる
    this.update({ boundarySupported: false, tokenId: null });
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  setSentence(index: number, st: SpeechText): void {
    this.sentences.set(index, st);
    if (((this.state.playing && this.parked === null) || this.following) && index === this.next) {
      if (this.following) {
        this.following = false;
        this.update({ playing: true });
      }
      this.enqueueFrom(this.gen);
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
      return;
    }
    if (!this.state.playing) this.startFrom(0);
  }

  pause(): void {
    if (!this.state.playing || this.state.paused) return;
    this.synth.pause();
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

  private startFrom(index: number): void {
    this.halt();
    if (!this.sentences.has(index)) return;
    this.next = index;
    this.head = index;
    this.update({ playing: true });
    this.enqueueFrom(this.gen);
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

  // next から連続して届いている文を積む
  private enqueueFrom(gen: number): void {
    while (this.sentences.has(this.next)) {
      const index = this.next++;
      const st = this.sentences.get(index)!;
      const u = this.makeUtterance(st.text);
      this.applyVoice(u);
      u.onstart = () => {
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
      // 合成に失敗した発話も onerror で終わる扱いにする
      u.onend = u.onerror = () => {
        this.live.delete(u);
        if (gen !== this.gen || index !== this.next - 1) return;
        // 最後に積んだ文を読み終えた。次の文が届けば続ける
        this.following = true;
        this.update({ playing: false, paused: false, sentence: null, tokenId: null });
      };
      this.speak(u);
    }
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
