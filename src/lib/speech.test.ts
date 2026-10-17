import { beforeEach, describe, expect, it } from 'vitest';
import type { SpeechText } from '../types';
import { Speaker, japaneseVoices, type SpeakerState } from './speech';

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  voice: SpeechSynthesisVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onboundary: ((e: { charIndex: number; name: string }) => void) | null;
}

// speechSynthesis の fake。先頭の発話を読み中とし、end() などで手動でイベントを起こす
class FakeSynth {
  queue: FakeUtterance[] = [];
  spoken: FakeUtterance[] = [];
  paused = false;
  voices = [
    { voiceURI: 'haruka', lang: 'ja-JP', name: 'Haruka' },
    { voiceURI: 'nanami', lang: 'ja-JP', name: 'Nanami' },
    { voiceURI: 'zira', lang: 'en-US', name: 'Zira' },
  ] as SpeechSynthesisVoice[];

  getVoices() {
    return this.voices;
  }
  speak(u: FakeUtterance) {
    this.spoken.push(u);
    this.queue.push(u);
    if (this.queue.length === 1) u.onstart?.();
  }
  cancel() {
    const q = this.queue;
    this.queue = [];
    // 実ブラウザは取り消した発話にも end / error を送る
    for (const u of q) u.onend?.();
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  get current() {
    return this.queue[0];
  }
  boundary(charIndex: number, name = 'word') {
    this.current.onboundary?.({ charIndex, name });
  }
  end() {
    const u = this.queue.shift()!;
    u.onend?.();
    this.queue[0]?.onstart?.();
  }
  get texts() {
    return this.queue.map((u) => u.text);
  }
}

function makeUtterance(text: string) {
  const u: FakeUtterance = {
    text,
    lang: '',
    rate: 1,
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
    onboundary: null,
  };
  return u as unknown as SpeechSynthesisUtterance;
}

// 1 文字 1 トークンの音声テキスト。tokenId = base + 位置
function st(text: string, base = 0): SpeechText {
  return { text, map: [...text].map((_, i) => ({ start: i, end: i + 1, tokenId: base + i })) };
}

let synth: FakeSynth;
let speaker: Speaker;
let state: SpeakerState;

beforeEach(() => {
  synth = new FakeSynth();
  speaker = new Speaker(synth as unknown as SpeechSynthesis, makeUtterance);
  speaker.onState((s) => (state = s));
});

describe('japaneseVoices', () => {
  it('lang が ja で始まる声だけ返す', () => {
    expect(japaneseVoices(synth as unknown as SpeechSynthesis).map((v) => v.voiceURI)).toEqual(['haruka', 'nanami']);
  });
});

describe('Speaker', () => {
  it('1 文 1 発話で、合成側には 1 文だけ積み、読み終えたら届いた順に次の文を積む', () => {
    speaker.setSentence(0, st('あい'));
    speaker.play();
    expect(synth.texts).toEqual(['あい']);
    expect(state).toMatchObject({ playing: true, sentence: 0 });

    speaker.setSentence(1, st('うえ'));
    speaker.setSentence(2, st('お'));
    expect(synth.texts).toEqual(['あい']);

    synth.end();
    expect(synth.texts).toEqual(['うえ']);
    expect(state.sentence).toBe(1);
    synth.end();
    expect(synth.texts).toEqual(['お']);
    synth.end();
    expect(state).toMatchObject({ playing: false, sentence: null });
  });

  it('先の文が抜けていれば、その文が届くまで後ろは積まない', () => {
    speaker.setSentence(0, st('あ'));
    speaker.play();
    speaker.setSentence(2, st('う'));
    synth.end();
    expect(synth.texts).toEqual([]);
    speaker.setSentence(1, st('い'));
    expect(synth.texts).toEqual(['い']);
    synth.end();
    expect(synth.texts).toEqual(['う']);
  });

  it('読み終えて次の文を待っている間に届いた文は続けて読む', () => {
    speaker.setSentence(0, st('あ'));
    speaker.play();
    synth.end();
    expect(state.playing).toBe(false);
    speaker.setSentence(1, st('い'));
    expect(synth.texts).toEqual(['い']);
    expect(state).toMatchObject({ playing: true, sentence: 1 });
  });

  it('再生していなければ届いた文を積まない', () => {
    speaker.setSentence(0, st('あ'));
    expect(synth.spoken).toEqual([]);
  });

  it('設定の声と速さを発話に付ける', () => {
    speaker.setVoice('nanami');
    speaker.setRate(1.5);
    speaker.setSentence(0, st('あ'));
    speaker.play();
    expect(synth.current).toMatchObject({ lang: 'ja-JP', rate: 1.5 });
    expect(synth.current.voice?.voiceURI).toBe('nanami');
  });

  it('読み上げ中に声を変えると、今の文から新しい声で積み直す', () => {
    speaker.setVoice('haruka');
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.setSentence(2, st('う'));
    speaker.play();
    synth.end();
    expect(state.sentence).toBe(1);

    speaker.setVoice('nanami');
    expect(synth.texts).toEqual(['い']);
    expect(synth.current.voice?.voiceURI).toBe('nanami');
    expect(state).toMatchObject({ playing: true, paused: false, sentence: 1 });
    synth.end();
    expect(synth.texts).toEqual(['う']);
    expect(synth.current.voice?.voiceURI).toBe('nanami');
  });

  it('読み上げ中に速さを変えると、今の文から新しい速さで積み直す', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.setSentence(2, st('う'));
    speaker.play();
    synth.end();

    speaker.setRate(1.5);
    expect(synth.texts).toEqual(['い']);
    expect(synth.current.rate).toBe(1.5);
    expect(state).toMatchObject({ playing: true, paused: false, sentence: 1 });
    synth.end();
    expect(synth.texts).toEqual(['う']);
    expect(synth.current.rate).toBe(1.5);
  });

  it('一時停止中に声・速さを変えると、再開したとき今の文から新しい声・速さで読む', () => {
    speaker.setVoice('haruka');
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.play();
    synth.end();
    speaker.pause();

    speaker.setVoice('nanami');
    speaker.setRate(1.5);
    expect(synth.texts).toEqual([]);
    expect(state).toMatchObject({ playing: true, paused: true, sentence: 1 });

    speaker.play();
    expect(synth.texts).toEqual(['い']);
    expect(synth.current).toMatchObject({ rate: 1.5 });
    expect(synth.current.voice?.voiceURI).toBe('nanami');
    expect(state).toMatchObject({ playing: true, paused: false, sentence: 1 });
  });

  it('respeakFrom で一時停止扱いの間に声・速さを変えても読み始めず、再開したときその文から新しい声・速さで読む', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.play();
    speaker.pause();
    speaker.respeakFrom(1);

    speaker.setVoice('nanami');
    speaker.setRate(1.5);
    expect(synth.texts).toEqual([]);
    expect(state).toMatchObject({ playing: true, paused: true, sentence: 1 });

    speaker.play();
    expect(synth.texts).toEqual(['い']);
    expect(synth.current).toMatchObject({ rate: 1.5 });
    expect(synth.current.voice?.voiceURI).toBe('nanami');
  });

  it('試聴中に声・速さを変えても試聴は続け、終われば今の文から新しい声・速さで読む', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.play();
    synth.end();
    speaker.preview('いい');

    speaker.setVoice('nanami');
    speaker.setRate(1.5);
    expect(synth.texts).toEqual(['いい']);
    expect(state).toMatchObject({ playing: true, paused: true, sentence: 1 });

    synth.end();
    expect(synth.texts).toEqual(['い']);
    expect(synth.current).toMatchObject({ rate: 1.5 });
    expect(synth.current.voice?.voiceURI).toBe('nanami');
  });

  it('止まっているときや、今と同じ値で声・速さを設定したときは積み直さない', () => {
    speaker.setVoice('haruka');
    speaker.setSentence(0, st('あ'));
    speaker.setVoice('nanami');
    speaker.setRate(1.5);
    expect(synth.spoken).toEqual([]);

    speaker.play();
    expect(synth.spoken).toHaveLength(1);
    speaker.setVoice('nanami');
    speaker.setRate(1.5);
    expect(synth.spoken).toHaveLength(1);
    expect(state).toMatchObject({ playing: true, sentence: 0 });
  });

  it('boundary の charIndex を対応表でトークン id に変える', () => {
    speaker.setSentence(0, {
      text: 'しゅうきんぺいは',
      map: [
        { start: 0, end: 7, tokenId: 10 },
        { start: 7, end: 8, tokenId: 11 },
      ],
    });
    speaker.play();
    synth.boundary(3);
    expect(state).toMatchObject({ tokenId: 10, boundarySupported: true, sentence: 0 });
    synth.boundary(7);
    expect(state.tokenId).toBe(11);
  });

  it('sentence の boundary は語のハイライトに使わない', () => {
    speaker.setSentence(0, st('あい', 5));
    speaker.play();
    synth.boundary(1, 'sentence');
    expect(state).toMatchObject({ tokenId: null, boundarySupported: false });
  });

  it('boundary が来ない声では tokenId=null のまま文単位で進む', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.play();
    expect(state).toMatchObject({ sentence: 0, tokenId: null, boundarySupported: false });
    synth.end();
    expect(state).toMatchObject({ sentence: 1, tokenId: null, boundarySupported: false });
  });

  it('文が変わると前の文の tokenId を消す', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い', 100));
    speaker.play();
    synth.boundary(0);
    expect(state.tokenId).toBe(0);
    synth.end();
    expect(state).toMatchObject({ sentence: 1, tokenId: null });
  });

  it('声を変えると boundary 対応を測り直す', () => {
    speaker.setSentence(0, st('あ'));
    speaker.play();
    synth.boundary(0);
    speaker.setVoice('haruka');
    expect(state.boundarySupported).toBe(false);
  });

  it('一時停止と再開', () => {
    speaker.setSentence(0, st('あ'));
    speaker.play();
    speaker.pause();
    expect(synth.paused).toBe(true);
    expect(state).toMatchObject({ playing: true, paused: true });
    speaker.play();
    expect(synth.paused).toBe(false);
    expect(state.paused).toBe(false);
    expect(synth.spoken).toHaveLength(1);
  });

  it('最初から読む：取り消して 0 文目から積み直し、古い発話のイベントは無視する', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.play();
    synth.end();
    speaker.restart();
    expect(synth.texts).toEqual(['あ']);
    expect(state).toMatchObject({ playing: true, sentence: 0 });
    // あ・い・（restart で）あ。取り消した「い」の end では次を積まない
    expect(synth.spoken.map((u) => u.text)).toEqual(['あ', 'い', 'あ']);
  });

  it('respeakFrom：読み上げ中なら作り直した文から読み直す', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.setSentence(2, st('う'));
    speaker.play();
    synth.end();
    synth.end();
    expect(state.sentence).toBe(2);

    speaker.setSentence(1, st('イ'));
    speaker.respeakFrom(1);
    expect(synth.texts).toEqual(['イ']);
    expect(state).toMatchObject({ playing: true, sentence: 1 });
    synth.end();
    expect(synth.texts).toEqual(['う']);
  });

  it('respeakFrom：一時停止中は再開せず、再開したときその文から読む', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.play();
    speaker.pause();
    speaker.setSentence(1, st('イ'));
    speaker.respeakFrom(1);
    expect(synth.texts).toEqual([]);
    expect(synth.paused).toBe(false);
    expect(state).toMatchObject({ playing: true, paused: true, sentence: 1 });

    speaker.play();
    expect(synth.texts).toEqual(['イ']);
    expect(state).toMatchObject({ playing: true, paused: false, sentence: 1 });
  });

  it('respeakFrom：読み上げ中でなければ何も読まない', () => {
    speaker.setSentence(0, st('あ'));
    speaker.respeakFrom(0);
    expect(synth.spoken).toEqual([]);
  });

  it('stop は止めて登録済みの文を捨てる', () => {
    speaker.setSentence(0, st('あ'));
    speaker.play();
    speaker.stop();
    expect(synth.texts).toEqual([]);
    expect(state).toMatchObject({ playing: false, sentence: null });
    speaker.play();
    expect(synth.spoken).toHaveLength(1);
  });

  it('preview は本編を一時停止扱いにしてその文字列だけを読み、終われば今の文から読み直す', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.play();
    synth.end();
    speaker.preview('しゅうきんぺい');
    expect(synth.texts).toEqual(['しゅうきんぺい']);
    expect(state).toMatchObject({ playing: true, paused: true, sentence: 1 });
    synth.end();
    expect(synth.texts).toEqual(['い']);
    expect(state).toMatchObject({ playing: true, paused: false, sentence: 1 });
  });

  it('試聴してから読みを直すと、試聴の後で直した文から読み直す（§6）', () => {
    speaker.setSentence(0, st('あ'));
    speaker.setSentence(1, st('い'));
    speaker.setSentence(2, st('う'));
    speaker.play();
    speaker.preview('いい');
    speaker.preview('いー');
    speaker.setSentence(1, st('イ'));
    speaker.respeakFrom(1);
    expect(synth.texts).toEqual(['いー']);
    synth.end();
    expect(synth.texts).toEqual(['イ']);
    expect(state).toMatchObject({ playing: true, paused: false, sentence: 1 });
    synth.end();
    expect(synth.texts).toEqual(['う']);
  });

  it('試聴中に再生を押すと試聴をやめて本編を続ける', () => {
    speaker.setSentence(0, st('あ'));
    speaker.play();
    speaker.preview('いい');
    speaker.play();
    expect(synth.texts).toEqual(['あ']);
    expect(state).toMatchObject({ playing: true, paused: false, sentence: 0 });
  });

  it('次の文を待っている間に試聴しても、試聴の後に届いている文を続けて読む', () => {
    speaker.setSentence(0, st('あ'));
    speaker.play();
    synth.end();
    speaker.preview('いい');
    speaker.setSentence(1, st('い'));
    expect(synth.texts).toEqual(['いい']);
    synth.end();
    expect(synth.texts).toEqual(['い']);
    speaker.setSentence(2, st('う'));
    expect(synth.texts).toEqual(['い']);
    synth.end();
    expect(synth.texts).toEqual(['う']);
  });

  it('止まっているときの試聴は、終わっても本編を読まない', () => {
    speaker.setSentence(0, st('あ'));
    speaker.preview('いい');
    synth.end();
    expect(synth.spoken.map((u) => u.text)).toEqual(['いい']);
    expect(state.playing).toBe(false);
  });

  it('積んだ後にトークンを作り直したら、boundary は新しい対応表で id に変える', () => {
    speaker.setSentence(0, st('あい'));
    speaker.play();
    speaker.setSentence(0, st('あい', 50));
    synth.boundary(1);
    expect(state.tokenId).toBe(51);
    // 音声テキストが変わっていれば語は特定しない
    speaker.setSentence(0, st('アイ', 70));
    synth.boundary(1);
    expect(state.tokenId).toBeNull();
  });

  it('onState は登録時に今の状態を返し、解除後は呼ばない', () => {
    const got: SpeakerState[] = [];
    const off = speaker.onState((s) => got.push(s));
    expect(got).toHaveLength(1);
    off();
    speaker.setSentence(0, st('あ'));
    speaker.play();
    expect(got).toHaveLength(1);
  });
});
