// ヘッダーとメインメニュー
import { apiKey, route, type Route } from '../state';

const LINKS: { href: Route; label: string }[] = [
  { href: '#/', label: '翻訳' },
  { href: '#/dict', label: '読み辞書' },
  { href: '#/setup', label: '設定' },
];

export function Nav() {
  const current = route.value;
  const hasKey = !!apiKey.value;
  return (
    <header class="site-header">
      <div class="site-brand">
        <div class="site-logo">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4V5z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        </div>
        <div class="site-title">よみあげ翻訳</div>
      </div>
      <nav aria-label="メインメニュー" class="site-nav">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} aria-current={current === l.href ? 'page' : undefined}>
            {l.label}
          </a>
        ))}
        <div class={hasKey ? 'key-chip key-chip--ok' : 'key-chip key-chip--none'}>
          <span aria-hidden="true" class="key-chip-dot" />
          {hasKey ? 'Groq key 登録済み' : 'key 未登録'}
        </div>
      </nav>
    </header>
  );
}
