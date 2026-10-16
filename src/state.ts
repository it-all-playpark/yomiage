// 画面で共有する状態とハッシュルーティング（spec §7・§8）
import { effect, signal } from '@preact/signals';
import type { Analyzer } from './lib/analyzer';
import { japaneseVoices, Speaker } from './lib/speech';
import {
  clearKey,
  getKey,
  loadDict,
  loadSettings,
  saveDict,
  saveSettings,
  setKey,
  storageAvailable,
} from './lib/storage';

export type Route = '#/' | '#/setup' | '#/dict';

function parseRoute(hash: string): Route {
  return hash === '#/setup' || hash === '#/dict' ? hash : '#/';
}

export const route = signal<Route>(parseRoute(location.hash));
window.addEventListener('hashchange', () => {
  route.value = parseRoute(location.hash);
});

export function navigate(r: Route): void {
  if (location.hash !== r) location.hash = r;
  route.value = r;
}

export const storageOk: boolean = storageAvailable();

export const apiKey = signal<string | null>(getKey());
effect(() => {
  const k = apiKey.value;
  if (k) setKey(k);
  else clearKey();
});

export const settings = signal(loadSettings());
effect(() => saveSettings(settings.value));

export const dict = signal(loadDict());
effect(() => saveDict(dict.value));

const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

export const speaker: Speaker | null = synth ? new Speaker(synth) : null;

export const voices = signal<SpeechSynthesisVoice[]>(synth ? japaneseVoices(synth) : []);
synth?.addEventListener('voiceschanged', () => {
  voices.value = japaneseVoices(synth);
});

// 設定の声と速さを Speaker に反映。setVoice は boundary の判定を戻すので、声が変わったときだけ呼ぶ
let appliedVoice: string | null = null;
effect(() => {
  const { voiceURI, rate } = settings.value;
  if (!speaker) return;
  if (voiceURI !== appliedVoice) {
    speaker.setVoice(voiceURI);
    appliedVoice = voiceURI;
  }
  speaker.setRate(rate);
});

export const analyzer = signal<Analyzer | null>(null);

/** 起動時：key が未登録なら設定画面へ（§8） */
export function redirectIfNoKey(): void {
  if (!apiKey.value) navigate('#/setup');
}
