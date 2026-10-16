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

export default defineConfig({
  base: './',
  plugins: [kuromojiDict, preact()],
  test: {
    environment: 'jsdom',
  },
});
