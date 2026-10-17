// NDJSON / SSE の行処理（spec §3.3）
import type { AiReading, Sentence } from '../types';

/** チャンクを溜めて、改行で終わった行だけを返す */
export class LineBuffer {
  private rest = '';

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split('\n');
    this.rest = parts.pop() ?? '';
    return parts.map(stripCr);
  }

  /** 改行で終わらなかった最後の行を返す */
  flush(): string[] {
    const last = stripCr(this.rest);
    this.rest = '';
    return last === '' ? [] : [last];
  }
}

function stripCr(s: string): string {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}

/** 1 行の JSON を Sentence にする。壊れた行・形式違反は null */
export function parseSentenceLine(line: string): Sentence | null {
  let v: unknown;
  try {
    v = JSON.parse(line.trim());
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.i !== 'number' || !Number.isInteger(o.i) || o.i < 0) return null;
  if (typeof o.ja !== 'string' || o.ja === '') return null;
  // readings は空のとき省かれることがあるので、無ければ空配列
  const raw = o.readings ?? [];
  if (!Array.isArray(raw)) return null;
  const readings: AiReading[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) return null;
    const { w, r: reading } = r as Record<string, unknown>;
    if (typeof w !== 'string' || typeof reading !== 'string' || w === '' || reading === '') return null;
    readings.push({ w, r: reading });
  }
  // p は段落の区切りにしか使わないので、無い・形式違反でも文は捨てない
  const p = typeof o.p === 'number' && Number.isInteger(o.p) && o.p >= 0 ? { p: o.p } : {};
  return { i: o.i, ...p, ja: o.ja, readings };
}

/** SSE の 1 行から choices[0].delta.content を取り出す。終端は 'DONE'、内容が無い行は null */
export function parseSseData(line: string): string | null | 'DONE' {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]') return 'DONE';
  try {
    const content = JSON.parse(data)?.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}
