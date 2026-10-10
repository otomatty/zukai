// Lint の本体。構造、図、文章の順に検査し、最後に textlint の結果を合わせる。AI は呼ばない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, sentences } from '../parse.js';
import { types } from '../figures/index.js';
import { widthOf } from '../figures/svg.js';
import { bundledLanguages } from 'shiki';
import { rules, prosePatterns } from './rules.js';
import { resolveRefs } from '../refs.js';
import { termsOf, findAvoided } from '../terms.js';

// ハイライトできる言語名。出力やログのように言語がないものは text と書く。
export const knownLang = (lang) => ['text', 'txt', 'plaintext', 'plain', 'ansi'].includes(lang) || lang in bundledLanguages;

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const count = (list) => list.reduce((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
const finding = (rule, line, message) => ({ rule, severity: rules[rule].severity, line, message });

function lintStructure(section, limits) {
  const out = [];
  const [first, second] = section.blocks;
  const figures = section.blocks.filter((b) => b.kind === 'figure' || b.kind === 'table');

  if (first?.kind !== 'paragraph') {
    out.push(finding('S001', section.line, `「${section.title}」の見出し直後に、結論を1文で書いてください。`));
  } else {
    const n = sentences(first.text).length;
    if (n !== 1) out.push(finding('S002', first.line, `主張文が${n}文あります。1文にして、残りは図の後ろの説明文へ移してください。`));
    if (first.text.length > limits.claim.maxChars) {
      out.push(finding('S003', first.line, `主張文が${first.text.length}字あります。上限は${limits.claim.maxChars}字です。`));
    }
  }

  if (figures.length === 0) {
    out.push(finding('S004', section.line, `「${section.title}」に図がありません。主張文の直後に図（yaml figure）か表を1つ置いてください。`));
  } else if (first?.kind === 'paragraph' && second !== figures[0]) {
    out.push(finding('S004', figures[0].line, '図は主張文の直後に置いてください。説明文は図の後ろに書きます。'));
  }
  if (figures.length > 1) {
    out.push(finding('S005', figures[1].line, `図が${figures.length}個あります。1セクション1図にして、セクションを分けてください。`));
  }

  // 画面を説明するセクションは、実物の画面を使う。見出しか主張文が画面の部品や操作に触れていて、図が screenshot でない場合に知らせる。
  // 「画面」だけでは発火させない。層の名前や製品名（管理画面の利用者数）としても使われるため。
  const about = `${section.title} ${first?.kind === 'paragraph' ? first.text : ''}`.match(/画面の(変更|表示|操作|見方|使い方|項目)|画面(で|から)[^、。]{0,8}(確認|操作|入力|変更|選)|ボタン|メニュー|ダイアログ|入力欄/);
  if (about && figures.length && !section.blocks.some((b) => b.kind === 'figure' && b.spec?.type === 'screenshot')) {
    out.push(finding('F003', figures[0].line, `「${about[0]}」とあり、画面を説明しています。実物の画面があるなら、screenshot で示してください。`));
  }

  const explanation = section.blocks.slice(1).filter((b) => b.kind === 'paragraph' || b.kind === 'list');
  const chars = explanation.reduce((sum, b) => sum + b.text.length, 0);
  if (chars > limits.explanation.maxChars) {
    out.push(finding('S006', explanation[0].line, `説明文が${chars}字あります。上限は${limits.explanation.maxChars}字です。図で伝わる内容を消すか、セクションを分けてください。`));
  }
  return out;
}

function lintFigure(block, limits, tokens, ctx) {
  const out = [];
  if (block.parseError) return [finding('F001', block.line, `YAML を読めません。${block.parseError}`)];
  const type = types[block.spec?.type];
  if (!type) {
    return [finding('F001', block.line, `type「${block.spec?.type}」は使えません。使える型は ${Object.keys(types).join('、')} です。`)];
  }
  const errors = type.validate(block.spec, limits, ctx);
  errors.forEach((m) => out.push(finding('F001', block.line, m)));
  if (errors.length) return out;

  const check = (list, max, name) =>
    list
      .filter((s) => widthOf(s) > max)
      .forEach((s) => out.push(finding('F002', block.line, `${name}「${s}」が全角${Math.ceil(widthOf(s))}字相当あります。上限は${max}字です。`)));
  check(type.labels(block.spec), limits.figure.labelMaxWidth, 'ラベル');
  check(type.notes(block.spec), limits.figure.noteMaxWidth, '補足');
  if (!out.length) (type.fit?.(block.spec, tokens, ctx) ?? []).forEach((m) => out.push(finding('F002', block.line, m)));

  // 図の中の説明文（画面の注釈など）は、文章のルールでも検査する。
  out.push(...lintProse((type.prose?.(block.spec) ?? []).map((text) => ({ kind: 'paragraph', text, line: block.line }))));
  return out;
}

// 根拠の検査。コードは実物と、引用は出典の本文と照合する。図の番号が根拠の件数に収まるかも確かめる。
async function lintRefs(section, ctx, limits) {
  const out = [];
  const blocks = section.blocks.filter((b) => b.kind === 'refs');
  if (blocks.length > 1) out.push(finding('R001', blocks[1].line, '根拠のブロックが2つあります。1つにまとめてください。'));
  let count = 0;
  if (blocks.length) {
    const { errors, items } = await resolveRefs(blocks[0], ctx, limits);
    count = items.length;
    for (const it of [...errors, ...items]) {
      if (it.error) out.push(finding(it.rule, blocks[0].line, it.error));
      if (it.warn) out.push(finding('R004', blocks[0].line, it.warn));
      if (it.kind === 'code') out.push(...lintProse([{ kind: 'paragraph', text: it.note, line: blocks[0].line }]));
    }
  }
  // 図の根拠の番号は、仕様の検証に通った図からだけ読む。書きかけの図は F001 で知らせ、ここで例外を出さない。
  for (const b of section.blocks.filter((x) => x.kind === 'figure' && !x.parseError && types[x.spec?.type] && !types[x.spec.type].validate(x.spec, limits, ctx).length)) {
    const used = types[b.spec.type].refs?.(b.spec) ?? [];
    const bad = used.filter((n) => !Number.isInteger(n) || n < 1 || n > count);
    if (bad.length) out.push(finding('R001', b.line, count ? `図の番号 ${bad.join('、')} に対応する根拠がありません。根拠は${count}件です。` : `図に番号 ${bad.join('、')} がありますが、根拠のブロック（yaml refs）がありません。`));
  }
  return out;
}

function lintCode(blocks) {
  return blocks
    .filter((b) => b.kind === 'code' && !knownLang(b.lang))
    .map((b) =>
      finding('C001', b.line, b.lang ? `言語名「${b.lang}」はハイライトできません。対応する名前（ts、python、bash、sql など）にしてください。` : 'コードブロックに言語名を書いてください。出力やログは text と書きます。'),
    );
}

function lintProse(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind !== 'paragraph' && b.kind !== 'list') continue;
    for (const s of sentences(b.text)) {
      const seen = new Set();
      for (const p of prosePatterns) {
        const m = s.match(p.re);
        if (!m || seen.has(p.rule)) continue;
        seen.add(p.rule);
        out.push({ ...finding(p.rule, b.line, `「${m[0]}」 ${p.hint}`), ...(p.severity ? { severity: p.severity } : {}) });
      }
    }
  }
  return out;
}

// 用語集の表記。見出し、本文、図のラベルと補足、ナレーションを調べる。
function lintTerms(doc, terms, source, limits, ctx) {
  if (!terms.length) return [];
  const rows = source.split('\n');
  const texts = [];
  if (doc.title) texts.push({ text: doc.title, line: doc.titleLine ?? 1 });
  for (const s of doc.sections) texts.push({ text: s.title, line: s.line });
  for (const b of [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)]) {
    if (b.kind === 'paragraph' || b.kind === 'list') texts.push({ text: b.text, line: b.line });
    // 図のラベルと補足は、仕様の検証に通った図からだけ取り出す。書きかけの図は F001 で知らせ、ここでは読まない。
    if (b.kind === 'figure' && b.spec && types[b.spec.type] && !b.parseError && !types[b.spec.type].validate(b.spec, limits, ctx).length) {
      const t = types[b.spec.type];
      for (const x of [...(t.labels?.(b.spec) ?? []), ...(t.notes?.(b.spec) ?? [])]) texts.push({ text: x, line: b.line });
    }
    // 表は、資料にも動画にも出るので、セルの文字を行ごとに調べる。区切りの行（|---|）は飛ばす。
    if (b.kind === 'table') {
      for (let i = b.line; i <= b.endLine; i++) {
        const row = rows[i - 1] ?? '';
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(row)) continue;
        texts.push({ text: row.replace(/\|/g, ' '), line: i });
      }
    }
    // ナレーションは、字幕に出る文だけを調べる。時刻の目印 {#名前} と演技のタグ <short pause> は、読み上げにも字幕にも出ないため外す。
    if (b.kind === 'narration' && Array.isArray(b.lines)) {
      // 行番号は、ブロックの中でその行の文が書かれている行にする。見つからなければブロックの先頭の行にする。
      let from = b.line;
      for (const l of b.lines) {
        const raw = String((typeof l === 'string' ? l : l?.text) ?? '');
        const key = raw.slice(0, 12);
        const at = key ? rows.findIndex((r, i) => i + 1 > from && i + 1 <= b.endLine && r.includes(key)) : -1;
        if (at >= 0) from = at + 1;
        texts.push({ text: raw.replace(/\{#[\w-]+\}|<[^<>]+>/g, ''), line: at >= 0 ? at + 1 : b.line });
      }
    }
  }
  const out = [];
  const seen = new Set();
  for (const { text, line } of texts) {
    for (const hit of findAvoided(text, terms)) {
      const key = `${line}:${hit.avoid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(finding('P007', line, `「${hit.avoid}」は、用語集では「${hit.use}」と書きます。`));
    }
  }
  return out;
}

// textlint の提案型ルールは warn に落とす。対象は contract/limits.json の textlint.warnOnly に書く。
async function lintWithTextlint(source, file, warnOnly) {
  const { createLinter, loadTextlintrc } = await import('textlint');
  const descriptor = await loadTextlintrc({ configFilePath: path.join(root, '.textlintrc.json') });
  const linter = createLinter({ descriptor });
  const result = await linter.lintText(source, file.endsWith('.md') ? file : `${file}.md`);
  return result.messages.map((m) => ({
    rule: `T:${m.ruleId}`,
    severity: m.severity === 2 && !warnOnly.includes(m.ruleId) ? 'error' : 'warn',
    line: m.loc?.start?.line ?? m.line,
    message: m.message.split('\n')[0],
  }));
}

export async function lint(source, file, { textlint = true } = {}) {
  const limits = readJson('contract/limits.json');
  const tokens = readJson('contract/tokens.json');
  const doc = parse(source);
  const ctx = { baseDir: path.dirname(path.resolve(file)) };
  let findings = [...lintProse(doc.lead), ...lintCode(doc.lead)];

  for (const section of doc.sections) {
    if (section.container) continue;
    findings.push(...lintStructure(section, limits));
    section.blocks.filter((b) => b.kind === 'figure').forEach((b) => findings.push(...lintFigure(b, limits, tokens, ctx)));
    findings.push(...lintProse(section.blocks), ...lintCode(section.blocks), ...(await lintRefs(section, ctx, limits)));
  }
  findings.push(...lintTerms(doc, termsOf(ctx.baseDir), source, limits, ctx));
  if (textlint) findings.push(...(await lintWithTextlint(source, file, limits.textlint.warnOnly)));

  // 抑制。セクション内に <!-- zukai-ignore ルールID 理由 --> を書くと、そのセクションでそのルールを外す。理由は必須。
  const suppressed = [];
  findings = findings.filter((f) => {
    const section = doc.sections.find((s) => f.line >= s.line && f.line <= s.endLine);
    const hit = (section?.ignores ?? []).find((g) => g.rule === f.rule && g.reason);
    if (hit) suppressed.push({ rule: f.rule, line: f.line, reason: hit.reason });
    return !hit;
  });

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return {
    file,
    ok: findings.every((f) => f.severity !== 'error'),
    sections: doc.sections.filter((s) => !s.container).length,
    // 図の型ごとの個数と、自由な図の題名。stats で、型の利用実績を見るために記録する。
    figures: count(doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'figure' || b.kind === 'table').map((b) => (b.kind === 'table' ? '表' : String(b.spec?.type ?? '不明')))),
    free: doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'figure' && b.spec?.type === 'free').map((b) => types.free.title(b.spec)).filter(Boolean),
    findings,
    suppressed,
  };
}
