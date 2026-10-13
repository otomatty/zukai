import { contrast, TEXT_CONTRAST } from '../color.ts';
import type { Tokens } from '../types.ts';

/** テーマの面色で本文が読めない場合は、本文と対になるページの地色を使う。 */
export function officeSurface(tokens: Tokens): string {
  const { ink, surface, paper } = tokens.color;
  return (contrast(ink, surface) >= TEXT_CONTRAST ? surface : paper).slice(1);
}

/** ページ背景上で読める装飾文字色を選び、不足する場合は本文色に戻す。 */
export function officeTextColor(tokens: Tokens, candidate: string): string {
  return (contrast(candidate, tokens.color.paper) >= TEXT_CONTRAST ? candidate : tokens.color.ink).slice(1);
}
