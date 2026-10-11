// 図の型が共有する SVG の部品。色・フォント・寸法は tokens（contract/tokens.json にテーマを重ねたもの）からだけ取る。

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 全角換算の幅。全角 1、半角 0.5 と数える。ラベル長の上限と箱の幅の計算に使う。
export function widthOf(text) {
  let w = 0;
  for (const ch of String(text)) w += ch.codePointAt(0) > 0xff ? 1 : 0.55;
  return w;
}

export const px = (text, fontSize) => widthOf(text) * fontSize;

// グラデーションの向き。CSS の角度（90 は左から右、180 は上から下）を、図形の外枠に対する始点と終点にする。
export function gradientVector(angle) {
  const r = (angle * Math.PI) / 180;
  const [dx, dy] = [Math.sin(r) / 2, -Math.cos(r) / 2];
  const n = (v) => +v.toFixed(4);
  return { x1: n(0.5 - dx), y1: n(0.5 - dy), x2: n(0.5 + dx), y2: n(0.5 + dy) };
}

// テーマのグラデーション。zk-grad は塗りと線、zk-grad-tint は淡い面に使う。色が無ければ何も足さない。
function gradientDefs(t) {
  const stops = t.gradient.stops;
  if (!stops.length) return '';
  const v = gradientVector(t.gradient.angle);
  const at = (i) => +(i / (stops.length - 1)).toFixed(4);
  const grad = (id, opacity) => `<linearGradient id="${id}" x1="${v.x1}" y1="${v.y1}" x2="${v.x2}" y2="${v.y2}">${stops.map((c, i) => `<stop offset="${at(i)}" stop-color="${c}"${opacity < 1 ? ` stop-opacity="${opacity}"` : ''}/>`).join('')}</linearGradient>`;
  return grad('zk-grad', 1) + grad('zk-grad-tint', TINT);
}
// 淡いグラデーションの濃さ。紙の色の上に、この割合で重ねる。
export const TINT = 0.16;

// 強調した箱の描き方。emphasis.box で選ぶ。zk-on-em は、強調した箱の上の文字。
// flat は単色の淡い面と強調の色の枠、fill はグラデーションの面に白抜きの文字、tint は淡いグラデーションの面とグラデーションの枠、outline はグラデーションの枠だけ。
function emphasisCss(t) {
  const c = t.color;
  const sw = t.figure.stroke;
  const box = {
    flat: `fill:${c.accentSurface};stroke:${c.accent};stroke-width:${sw * 1.5}`,
    fill: 'fill:url(#zk-grad);stroke:none',
    tint: `fill:url(#zk-grad-tint);stroke:url(#zk-grad);stroke-width:${sw * 1.5}`,
    outline: `fill:${c.paper};stroke:url(#zk-grad);stroke-width:${sw * 2}`,
  }[t.emphasis.box];
  const on = t.emphasis.box === 'fill' ? c.onAccent : c.accent;
  const onNote = t.emphasis.box === 'fill' ? c.onAccent : c.sub;
  return [`.zk-box-em{${box}}`, `.zk-on-em{fill:${on}}`, `.zk-on-em-note{fill:${onNote}}`];
}

export function open(t, height, title) {
  const c = t.color;
  const f = t.figure;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.width} ${height}" width="100%" role="img" aria-label="${esc(title)}">`,
    '<style>',
    `.zk-text{font-family:${t.font.replace(/"/g, "'")};fill:${c.ink};font-size:${t.size.label}px;font-weight:600}`,
    `.zk-note{font-family:${t.font.replace(/"/g, "'")};fill:${c.sub};font-size:${t.size.note}px}`,
    `.zk-box{fill:${c.surface};stroke:${c.line};stroke-width:${f.stroke}}`,
    ...emphasisCss(t),
    `.zk-em{fill:${c.accent}}`,
    `.zk-grad{fill:${t.gradient.stops.length ? 'url(#zk-grad)' : c.accent}}`,
    `.zk-band{fill:${c.paper};stroke:${c.line};stroke-width:${f.stroke}}`,
    `.zk-line{fill:none;stroke:${c.sub};stroke-width:${f.stroke}}`,
    `.zk-dash{fill:none;stroke:${c.line};stroke-width:${f.stroke};stroke-dasharray:4 4}`,
    '</style>',
    '<defs><marker id="zk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">',
    `<path d="M1 1 L9 5 L1 9 Z" fill="${c.sub}"/></marker>${gradientDefs(t)}</defs>`,
  ].join('');
}

export const close = () => '</svg>';

// 文字の縦中央を y に合わせるためのベースライン。dominant-baseline は描画ソフトによって扱いが違うので使わない。
export const mid = (y, fontSize) => y + fontSize * 0.36;

// 箱と中の文字。note があれば 2 行、なければ 1 行で中央に置く。
export function box(t, x, y, w, h, label, { note, emphasis, ref } = {}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cls = emphasis ? 'zk-box-em' : 'zk-box';
  const textCls = emphasis ? 'zk-text zk-on-em' : 'zk-text';
  const noteCls = emphasis ? 'zk-note zk-on-em-note' : 'zk-note';
  const out = [`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${t.figure.radius}"/>`];
  if (note) {
    out.push(`<text class="${textCls}" x="${cx}" y="${mid(cy - 9, t.size.label)}" text-anchor="middle">${esc(label)}</text>`);
    out.push(`<text class="${noteCls}" x="${cx}" y="${mid(cy + 12, t.size.note)}" text-anchor="middle">${esc(note)}</text>`);
  } else {
    out.push(`<text class="${textCls}" x="${cx}" y="${mid(cy, t.size.label)}" text-anchor="middle">${esc(label)}</text>`);
  }
  // 根拠の番号。箱の右上の角に重ねる。
  if (ref !== undefined) {
    out.push(`<circle cx="${x + w - 12}" cy="${y}" r="10" fill="${t.color.accent}"/><text class="zk-note" x="${x + w - 12}" y="${mid(y, 12)}" text-anchor="middle" style="fill:${t.color.onAccent};font-weight:700">${esc(ref)}</text>`);
  }
  // 箱1つを1つの g にまとめる。動画では、この単位で現れる。
  return `<g>${out.join('')}</g>`;
}

export const arrow = (d, dashed = false) =>
  `<path class="${dashed ? 'zk-dash' : 'zk-line'}" d="${d}" marker-end="url(#zk-arrow)"/>`;

// 図の仕様に共通する検証の部品。
export function unknownKeys(obj, allowed, where) {
  return Object.keys(obj ?? {})
    .filter((k) => !allowed.includes(k))
    .map((k) => `${where} に未定義のキー「${k}」があります。使えるキーは ${allowed.join('、')} です。`);
}

// 作図用の小さな部品。箱と矢印だけでは描けない型（分岐、分解、日程、変更前後）が使う。
export const txt = (t, x, y, s, o = {}) =>
  `<text class="${o.cls ?? 'zk-note'}" x="${x}" y="${y}" text-anchor="${o.anchor ?? 'middle'}" style="${o.fill ? `fill:${o.fill};` : ''}${o.weight ? `font-weight:${o.weight};` : ''}${o.size ? `font-size:${o.size}px;` : ''}">${esc(s)}</text>`;
export const ln = (t, d, o = {}) => `<path d="${d}" fill="none" stroke="${o.color ?? t.color.line}" stroke-width="${o.w ?? t.figure.stroke}" stroke-linecap="round"/>`;
// 強調した箱。描き方は open() の zk-box-em で決まる。中の文字は zk-on-em を付ける。
export const emRect = (t, x, y, w, h, rx = t.figure.radius) => `<rect class="zk-box-em" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
export const rect = (t, x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? t.figure.radius}" fill="${o.fill ?? t.color.paper}" stroke="${o.stroke ?? t.color.line}" stroke-width="${o.sw ?? t.figure.stroke}"/>`;

// n 個の箱を横に並べるときの、箱の幅と各箱の左端。全体を中央に寄せる。
export function columns(t, n, gap, maxWidth) {
  // 両端の箱の枠線が切れないよう、左右に1pxずつ余白を取る。
  const w = Math.min(maxWidth, (t.figure.width - 2 - (n - 1) * gap) / n);
  const left = (t.figure.width - (n * w + (n - 1) * gap)) / 2;
  return { w, xs: Array.from({ length: n }, (_, i) => left + i * (w + gap)) };
}
