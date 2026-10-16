import { render } from 'preact';
import { App } from './app';
import { loadAnalyzer } from './lib/analyzer';
import { analyzer, redirectIfNoKey } from './state';
import './styles/base.css';

redirectIfNoKey();
render(<App />, document.getElementById('app')!);

// 形態素解析の辞書は重いので画面を出した後に読む（§9 V5）。届くまでは AI と辞書の読みだけで表示する
loadAnalyzer(import.meta.env.BASE_URL + 'dict/').then(
  (a) => {
    analyzer.value = a;
  },
  (e) => console.error('kuromoji の辞書を読み込めませんでした', e),
);
