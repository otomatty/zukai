import { open, close, box, esc, px, mid } from './svg.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';

const schema = {
  layers: {
    type: 'list', required: true, min: 2, max: 'layers.maxLayers', desc: '層の配列。上から順に積む',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '層の名前' },
        items: { type: 'list', required: true, min: 1, max: 'layers.maxItems', of: { type: 'string' }, desc: '層に含まれる要素の名前の配列' },
      },
    },
  },
} as const satisfies Fields;
export type LayersSpec = { type: 'layers' } & Infer<typeof schema>;

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
  fields: describe(schema, contractLimits),

  validate: (spec, limits) => checkSpec(spec, schema, 'layers', limits),

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
