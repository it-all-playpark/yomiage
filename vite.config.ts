import { defineConfig } from 'vitest/config';
import type { Connect, Plugin } from 'vite';
import preact from '@preact/preset-vite';

// dev / preview のサーバー（sirv）は .gz に Content-Encoding: gzip を付けるため、ブラウザが先に解凍し
// kuromoji が二重に解凍して失敗する。辞書の .dat.gz だけ Content-Encoding を外して gzip のまま返す
const stripDictEncoding: Connect.NextHandleFunction = (req, res, next) => {
  // @types/node を入れていないので url の型が無い
  const url = (req as { url?: string }).url;
  if (url?.split('?')[0].endsWith('.dat.gz')) {
    const writeHead = res.writeHead.bind(res) as (code: number, headers?: Record<string, unknown>) => typeof res;
    res.writeHead = ((code: number, headers?: Record<string, unknown>) => {
      if (headers) delete headers['Content-Encoding'];
      res.removeHeader('Content-Encoding');
      return writeHead(code, headers);
    }) as typeof res.writeHead;
  }
  next();
};

const kuromojiDict: Plugin = {
  name: 'kuromoji-dict-raw-gzip',
  configureServer(server) {
    server.middlewares.use(stripDictEncoding);
  },
  configurePreviewServer(server) {
    server.middlewares.use(stripDictEncoding);
  },
};

// key は localStorage にあるので、読み込める script と送り先を絞り、依存が乗っ取られても外へ出せなくする。
// GitHub Pages はヘッダーを付けられないので meta で入れる。dev は CSS を <style> で差し込むため build だけ
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self' https://api.groq.com",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
};

export default defineConfig({
  base: './',
  plugins: [kuromojiDict, csp, preact()],
  test: {
    environment: 'jsdom',
  },
});
