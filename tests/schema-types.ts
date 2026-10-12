// npm run typecheck で確かめる型のテスト（実行はしない）。スキーマから作る仕様の型が、検証で通る形と合うことを確かめる。
import type { ZonesSpec } from '../src/figures/zones.ts';
import type { SankeySpec } from '../src/figures/sankey.ts';
import type { StateSpec } from '../src/figures/state.ts';
const two: ZonesSpec['links'][number] = ['a', 'b'];
const three: ZonesSpec['links'][number] = ['a', 'b', 'c'];
// @ts-expect-error 1つだけは足りない
const one: ZonesSpec['links'][number] = ['a'];
// @ts-expect-error sankey は量まで必須
const s2: SankeySpec['links'][number] = ['a', 'b'];
const s3: SankeySpec['links'][number] = ['a', 'b', 1];
// @ts-expect-error state はきっかけまで必須
const t2: StateSpec['transitions'][number] = ['a', 'b'];
export { two, three, one, s2, s3, t2 };
