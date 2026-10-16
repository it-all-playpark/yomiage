// Speaker の再生状態を購読する
import { useEffect, useState } from 'preact/hooks';
import type { Speaker, SpeakerState } from '../../lib/speech';

const IDLE: SpeakerState = { playing: false, paused: false, sentence: null, tokenId: null, boundarySupported: false };

export function useSpeakerState(speaker: Speaker | null): SpeakerState {
  const [s, set] = useState<SpeakerState>(IDLE);
  useEffect(() => (speaker ? speaker.onState(set) : undefined), [speaker]);
  return s;
}
