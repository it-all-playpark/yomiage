// 翻訳セッションに state.ts の共有状態を渡す
import type { SessionEnv } from '../../session';
import { analyzer, dict, speaker } from '../../state';

export const env: SessionEnv = {
  speaker,
  dict: () => dict.value,
  setDict: (d) => {
    dict.value = d;
  },
  analyzer: () => analyzer.value,
};
