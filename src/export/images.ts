import { imageSize } from 'image-size';
import { toPng } from '../png.ts';
import type { ExportDocument } from './document.ts';

/** 同梱画像またはdata URIを埋め込み用に読む。SVGはPNGへ変換し、外部URL・未対応形式はエラーにする。 */
export function imageOf(doc: ExportDocument, url: string): { data: Buffer; width: number; height: number; type: 'png' | 'jpg' | 'gif' | 'bmp' } {
  const data = doc.assets.get(url.split(/[?#]/)[0]) ?? (/^data:image\/[\w.+-]+;base64,/i.test(url) ? Buffer.from(url.split(',')[1], 'base64') : null);
  if (!data) throw new Error(`画像「${url}」を埋め込めません。PDF・Word・PowerPointでは、画像をローカルに保存して原稿から相対パスで参照してください。`);
  const size = imageSize(data);
  if (size.type === 'svg') return { ...toPng(data.toString('utf8'), doc.tokens.color.paper), type: 'png' };
  if (!['png', 'jpg', 'gif', 'bmp'].includes(size.type ?? '')) throw new Error(`画像形式「${size.type}」には対応していません。PNG、JPEG、GIF、BMP、SVGを使ってください。`);
  return { data, width: size.width, height: size.height, type: size.type as 'png' | 'jpg' | 'gif' | 'bmp' };
}
