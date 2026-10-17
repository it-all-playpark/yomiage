# yomiage

Groq で翻訳と読み付けを行い、ブラウザの音声で読み上げる Web アプリ（API key はブラウザにだけ保存）

外国語の文章を日本語に訳し、漢字の熟語や固有名詞を正しい読みで読み上げます。読みを間違えたら、訳文の語をクリックしてその場で直せます。

## ドキュメント

- [要件定義](docs/requirements.md)：背景・目的・決定事項・機能要件
- [実装仕様](docs/spec.md)：構成・Groq とのやり取り・読みの決め方・保存形式・実装前の検証項目
- [UI モック](docs/mock/README.md)：3 画面のモックと見た目の決まり

## 使い方（利用者向け）

1. [Groq](https://console.groq.com) に無料で登録し、API key を作る
2. このアプリを開き、設定画面で key を貼り付ける（key はブラウザにだけ保存され、開発者のサーバーには送られません）
3. 原文を貼って「翻訳する」

公開 URL は、GitHub Pages で公開した後に追記します。

### コピーを 2 回で開く（DeepL のように）

`<公開URL>#/?text=<URL エンコードした本文>` で開くと、その本文をすぐ翻訳します。OS 側のツールで「コピーを素早く 2 回」を拾ってこの URL を開けば、選んだ文章を Cmd+C C（Windows は Ctrl+C C）で読み上げられます。下の例の `<公開URL>` は自分が開いている yomiage の URL（末尾の `#/` より前）に置き換えてください。起動のたびに新しいタブが開きます。

#### macOS（Hammerspoon）

1. [Hammerspoon](https://www.hammerspoon.org) を入れ、システム設定 → プライバシーとセキュリティ → アクセシビリティで許可する
2. `~/.hammerspoon/init.lua` に次を足し、メニューバーのアイコンから Reload Config する

```lua
local yomiageLast = 0
local yomiageBase = "<公開URL>#/?text="
yomiageTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(e)
  if e:getFlags():containExactly({ "cmd" }) and hs.keycodes.map[e:getKeyCode()] == "c" then
    local now = hs.timer.secondsSinceEpoch()
    if now - yomiageLast < 0.4 then
      yomiageLast = 0
      hs.timer.doAfter(0.15, function() -- コピーの反映を待つ
        local text = hs.pasteboard.getContents()
        if text then hs.urlevent.openURL(yomiageBase .. hs.http.encodeForQuery(text)) end
      end)
    else
      yomiageLast = now
    end
  end
  return false -- 普段のコピーはそのまま通す
end):start()
```

#### Windows（AutoHotkey v2）

1. [AutoHotkey v2](https://www.autohotkey.com) を入れる
2. 次を `yomiage.ahk` として保存し、ダブルクリックで常駐させる（ログイン時に動かすなら、`Win+R` → `shell:startup` で開くフォルダにショートカットを置く）

```ahk
#Requires AutoHotkey v2.0

; ターミナルでは Ctrl+C が中断なので除外する
#HotIf !WinActive("ahk_exe WindowsTerminal.exe")
~^c:: {  ; ~ で普段のコピーはそのまま通す
    static last := 0
    if (A_TickCount - last < 400) {
        last := 0
        Sleep 150  ; コピーの反映を待つ
        if (A_Clipboard != "")
            Run "<公開URL>#/?text=" UriEncode(A_Clipboard)
    } else {
        last := A_TickCount
    }
}
#HotIf

UriEncode(s) {
    buf := Buffer(StrPut(s, "UTF-8"))
    StrPut(s, buf, "UTF-8")
    out := ""
    loop buf.Size - 1 {
        b := NumGet(buf, A_Index - 1, "UChar")
        if (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A)
            || b = 0x2D || b = 0x2E || b = 0x5F || b = 0x7E
            out .= Chr(b)
        else
            out .= Format("%{:02X}", b)
    }
    return out
}
```

Windows の手順は実機で確かめていません。とくに `Run` で渡せる URL の長さに上限があり、長い文章（数千字以上）は途中で切れるかもしれません。

## 開発

必要なもの：Node.js 24、pnpm

```sh
pnpm install
pnpm dev        # 開発サーバー（http://localhost:5173）
pnpm test       # Vitest
pnpm typecheck  # 型チェック
pnpm build      # dist/ に静的ファイルを出力
pnpm preview    # dist/ を配信して確認
```

- kuromoji の辞書（`node_modules/kuromoji/dict/*.dat.gz`）は、`dev` / `build` / `test` の前に `scripts/copy-dict.mjs` が `public/dict/` にコピーする（`public/dict/` は git に入れない）。手で実行するときは `pnpm copy-dict`
- 辞書は gzip のままブラウザに届け、kuromoji が解凍する。Vite の dev / preview サーバーは `.gz` に `Content-Encoding: gzip` を付けてブラウザに先に解凍させてしまうので、`vite.config.ts` で `.dat.gz` だけこのヘッダーを外している
- 画面はハッシュで切り替える（`#/` 翻訳、`#/setup` 設定、`#/dict` 読み辞書）

## 公開

`main` に push すると `.github/workflows/pages.yml` がテスト・ビルドして GitHub Pages に公開する。初回はリポジトリの Settings → Pages で Source を「GitHub Actions」にする。
