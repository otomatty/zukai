import { open, close, box, esc, px, mid, unknownKeys } from './svg.ts';
import type { FigureType, Tokens } from '../types.ts';

export interface Layer {
  label: string;
  items: string[];
}
export interface LayersSpec {
  type: 'layers';
  layers: Layer[];
}

const LABEL_W = 150;
const ITEM_GAP = 12;
const itemWidth = (t: Tokens, n: number) => (t.figure.width - LABEL_W - 14 - (n - 1) * ITEM_GAP) / n;

// layers: 層になった構成。上の層が下の層を使う関係を、積み重ねで示す。
export default {
  name: 'layers',
  summary: '層になった構成を、上から下へ積み重ねる',
  when: '上の層が下の層を使う、2〜4層の構成',
  example: `type: layers
layers:
  - label: 画面
    items: [ログイン画面, 設定画面]
  - label: API
    items: [認証API, 利用者API]
  - label: 保存先
    items: [利用者DB, セッションDB]`,
  fields: [
    'layers: 層の配列。上から順に積む',
    'layers[].label: 層の名前（必須）',
    'layers[].items: 層に含まれる要素の名前の配列（必須）',
  ],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'layers'], 'layers')];
    if (!Array.isArray(spec.layers) || spec.layers.length < 2) {
      errors.push('layers には層が2つ以上必要です。');
      return errors;
    }
    if (spec.layers.length > limits.layers.maxLayers) {
      errors.push(`層が${spec.layers.length}個あります。上限は${limits.layers.maxLayers}個です。`);
    }
    spec.layers.forEach((l, i) => {
      errors.push(...unknownKeys(l, ['label', 'items'], `layers[${i}]`));
      if (!l || typeof l.label !== 'string') errors.push(`layers[${i}] に label がありません。`);
      if (!Array.isArray(l?.items) || l.items.length === 0 || l.items.some((x: unknown) => typeof x !== 'string')) {
        errors.push(`layers[${i}].items は名前の配列にしてください。`);
      } else if (l.items.length > limits.layers.maxItems) {
        errors.push(`layers[${i}].items が${l.items.length}個あります。上限は${limits.layers.maxItems}個です。`);
      }
    });
    return errors;
  },

  // 箱の幅は要素の数で決まる。文字が箱に収まらない組み合わせを検出する。
  fit(spec, t) {
    return spec.layers.flatMap((l) => [
      ...(px(l.label, t.size.label) + 36 > LABEL_W ? [`層の名前「${l.label}」が長く、要素の箱に近づきます。全角7字相当までにしてください。`] : []),
      ...l.items
        .filter((item) => px(item, t.size.label) + 16 > itemWidth(t, l.items.length))
        .map((item) => `層「${l.label}」の「${item}」が箱に収まりません。名前を短くするか、items を${l.items.length - 1}個以下にしてください。`),
    ]);
  },

  labels: (spec) => spec.layers.flatMap((l) => [l.label, ...l.items]),
  notes: () => [],

  render(spec, t) {
    const f = t.figure;
    const bandH = 72;
    const bandGap = 10;
    const height = spec.layers.length * bandH + (spec.layers.length - 1) * bandGap + 8;
    const out = [open(t, height, spec.layers.map((l) => l.label).join(' / '))];
    spec.layers.forEach((l, i) => {
      const y = 4 + i * (bandH + bandGap);
      out.push(`<rect class="zk-band" x="1" y="${y}" width="${f.width - 2}" height="${bandH}" rx="${f.radius}"/>`);
      out.push(`<text class="zk-text" x="20" y="${mid(y + bandH / 2, t.size.label)}">${esc(l.label)}</text>`);
      const w = itemWidth(t, l.items.length);
      l.items.forEach((item, j) => {
        out.push(box(t, LABEL_W + j * (w + ITEM_GAP), y + 12, w, bandH - 24, item));
      });
    });
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<LayersSpec>;
