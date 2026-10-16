// 画面の切り替え（ハッシュルーティング §8）と保存不可の知らせ（§7）
import { route, storageOk } from './state';
import { Dictionary } from './ui/Dictionary';
import { Main } from './ui/Main';
import { Nav } from './ui/Nav';
import { Setup } from './ui/Setup';

export function App() {
  const r = route.value;
  return (
    <>
      {!storageOk && (
        <div role="status" class="storage-banner">
          このブラウザでは保存ができません（プライベートウィンドウなど）。key と辞書はこの画面を閉じると消えます。
        </div>
      )}
      <Nav />
      {r === '#/setup' ? <Setup /> : r === '#/dict' ? <Dictionary /> : <Main />}
    </>
  );
}
