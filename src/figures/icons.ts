// 図に埋め込むアイコン。AWS のサービスは公式のアイコン（aws-icons パッケージ）を使い、一般的な記号は線画を自前で持つ。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tokens } from '../types.ts';

const awsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/aws-icons/icons/architecture-service');

// 一般的な記号。48×48 の枠に、線だけで描く。
const builtin: Record<string, string> = {
  user: '<circle cx="24" cy="16" r="8"/><path d="M8 42 C8 32 15 27 24 27 C33 27 40 32 40 42"/>',
  browser: '<rect x="5" y="9" width="38" height="30" rx="4"/><path d="M5 18 H43"/><path d="M11 13.5 h.01 M16 13.5 h.01"/>',
  server: '<rect x="8" y="7" width="32" height="14" rx="3"/><rect x="8" y="27" width="32" height="14" rx="3"/><path d="M14 14 h.01 M14 34 h.01 M22 14 H34 M22 34 H34"/>',
  database: '<ellipse cx="24" cy="12" rx="15" ry="6"/><path d="M9 12 V36 C9 39.5 15.5 42 24 42 C32.500 42 39 39.5 39 36 V12"/><path d="M9 24 C9 27.5 15.5 30 24 30 C32.5 30 39 27.5 39 24"/>',
  box: '<rect x="8" y="8" width="32" height="32" rx="6"/>',
};

export const builtinIcons: string[] = Object.keys(builtin);

const awsFile = (name: string): string | null => (name.startsWith('aws/') && /^[A-Za-z0-9-]+$/.test(name.slice(4)) ? path.join(awsDir, `${name.slice(4)}.svg`) : null);

export const iconExists = (name: string): boolean => Object.hasOwn(builtin, name) || Boolean(awsFile(name) && fs.existsSync(awsFile(name)!));

// アイコンを、指定した位置と大きさの SVG として返す。
export function iconSvg(name: string, x: number, y: number, size: number, t: Tokens): string {
  if (Object.hasOwn(builtin, name)) {
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 48 48"><g fill="none" stroke="${t.color.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${builtin[name]}</g></svg>`;
  }
  // 組み込みにない名前は、検証（iconExists）で AWS のアイコンと確かめてある。
  const inner = fs.readFileSync(awsFile(name)!, 'utf8').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/, '');
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 64 64">${inner}</svg>`;
}

// 名前の一部からアイコンを探す。AI や人が正しい名前を調べるために使う。
// 正式名に含まれない略称。よく使うものだけを置く。
const aliases: Record<string, string> = { sqs: 'simplequeue', sns: 'simplenotification', ses: 'simpleemail', s3: 'simplestorageservice', ecs: 'elasticcontainerservice', ecr: 'elasticcontainerregistry', eks: 'elastickubernetes', alb: 'elasticloadbalancing', elb: 'elasticloadbalancing', nlb: 'elasticloadbalancing', rds: 'amazonrds', iam: 'identityandaccessmanagement', kms: 'keymanagement', waf: 'awswaf', vpc: 'virtualprivatecloud', cdn: 'cloudfront' };

export function searchIcons(keyword = ''): string[] {
  const lower = keyword.toLowerCase();
  const k = Object.hasOwn(aliases, lower) ? aliases[lower] : lower;
  const aws = fs.existsSync(awsDir) ? fs.readdirSync(awsDir).filter((f) => f.endsWith('.svg')).map((f) => `aws/${f.slice(0, -4)}`) : [];
  return [...builtinIcons, ...aws].filter((n) => n.toLowerCase().includes(k));
}
