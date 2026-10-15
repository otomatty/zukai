// help と実行時の検査が共有する出力形式の一覧。重い依存はここでは読まない。
export const outputFormats = [
  { name: 'html', folder: false },
  { name: 'confluence', folder: true },
  { name: 'markdown', folder: true },
  { name: 'pdf', folder: false },
  { name: 'docx', folder: false },
  { name: 'pptx', folder: false },
  { name: 'svg', folder: true },
  { name: 'png', folder: true },
] as const;
export type OutputFormat = typeof outputFormats[number]['name'];
export const imageFormats = ['png', 'svg', 'mermaid'] as const;
export type ImageFormat = typeof imageFormats[number];
