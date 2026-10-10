// 原稿を動画のシーンの並びにし、ナレーションの長さから時間割を決める。入出力を持たない。
// シーンの演出は AI が html motion に自由に書く。ここでは、書かれたものを時間割に載せ、機械的に確かめられる形に整えるだけにする。
import path from 'node:path';
import { parse, sentences } from '../parse.js';
import { types } from '../figures/index.js';
import { readJson } from '../lint/index.js';
import MarkdownIt from 'markdown-it';

// 図の代わりに Markdown の表を置いたセクションの表。HTML は書けないようにして描く。
const tableMd = new MarkdownIt({ html: false });

// 時間割の定数（秒）。narrStart はシーンが始まってからナレーションが始まるまで。
export const TIMING = { narrStart: 0.6, tail: 0.9, transition: 0.9, minScene: 3, charsPerSec: 7.5, lineGap: 0.25, fadeOut: 1 };

// 部品に分けずに、図全体をまとめて出す型。ECharts の図と、画像を使う図。
const WHOLE = new Set(['bar', 'line', 'stack', 'progress', 'scatter', 'heatmap', 'sankey', 'boxplot', 'treemap', 'screenshot', 'free']);

// シーンごとの選択肢。AI が <zk-options> に書く。書かなければ既定値になる。
export const OPTIONS = {
  subtitles: ['on', 'off'],
  transition: ['pan', 'fade', 'zoom', 'cut'],
};
export const DEFAULT_OPTIONS = { subtitles: 'on', transition: 'pan', hold: 0 };

// ナレーションの1行。文字列か { text, style, example }。text には目印 {#名前} と、読み上げの指示のタグ <short pause> などを書ける。
// example は、たとえ話の行に付ける。たとえ話の数値は、原稿の根拠と照らし合わせない。
// 読み上げには目印だけを外した文を、字幕には目印とタグを外した文を使う。
export function parseLine(line) {
  const raw = typeof line === 'string' ? line : String(line?.text ?? '');
  const style = typeof line === 'object' && line?.style ? String(line.style) : null;
  const example = typeof line === 'object' && line?.example === true;
  const marks = {};
  let text = '';
  let speech = '';
  let last = 0;
  for (const m of raw.matchAll(/\{#([\w-]+)\}|<[^<>]+>/g)) {
    const piece = raw.slice(last, m.index);
    text += piece;
    speech += piece;
    if (m[1]) marks[m[1]] = text.length;
    else speech += m[0];
    last = m.index + m[0].length;
  }
  text += raw.slice(last);
  speech += raw.slice(last);
  return { text: text.replace(/\s+/g, ' ').trim(), speech: speech.trim(), style, example, marks };
}

// 2桁以上の数か小数を取り出す。全角の数字と桁区切りのカンマはそろえる。1桁の数は「3つ」のような言い回しに多いので見ない。
export const numbersIn = (s) =>
  [...String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/(\d),(?=\d{3})/g, '$1').matchAll(/\d+(?:\.\d+)?/g)]
    .map((m) => m[0])
    .filter((n) => n.length >= 2);

// 台本の形の検査。数値が原稿にあるか（V013）と、疑問から始まっているか（V014）。
// source は、そのシーンの根拠になる原稿の文字列（主張文、図、説明文、根拠）。
export function checkLines(lines, source, { needQuestion }) {
  const out = [];
  const known = new Set(numbersIn(source));
  for (const l of lines.filter((x) => !x.example)) {
    const missing = numbersIn(l.text).filter((n) => !known.has(n));
    if (missing.length) out.push({ severity: 'warn', rule: 'V013', message: `ナレーション「${l.text.slice(0, 24)}」の数値 ${missing.join('、')} が、原稿の主張文、図、説明文、根拠にありません。根拠のある数値にするか、たとえ話なら example: true を付けてください。` });
  }
  const isQuestion = (t) => /[？?][」』）)]*$/.test(t);
  if (needQuestion === 'first' && lines.length && !isQuestion(lines[0].text)) out.push({ severity: 'warn', rule: 'V014', message: `最初の行「${lines[0].text.slice(0, 24)}」が疑問の形ではありません。視聴者が抱きそうな疑問から始めてください。` });
  if (needQuestion === 'any' && lines.length && !lines.some((l) => isQuestion(l.text))) out.push({ severity: 'warn', rule: 'V014', message: 'オープニングに疑問の形の行がありません。この動画で答える疑問を示してください。' });
  return out;
}

// 動画用の配色。図の型は色を tokens からだけ読むので、ここで差し替えれば21種類すべてに効く。
export const videoTokens = (t) => ({ ...t, color: { ...t.color, ...t.video.figure.color }, chart: { ...t.chart, ...t.video.figure.chart } });

// <zk-options ...> を読み、HTML から外す。知らない名前や値は、検査の結果として返す。
export function readOptions(html, defaults = DEFAULT_OPTIONS) {
  const options = { ...defaults };
  const findings = [];
  const out = html.replace(/<zk-options\b([^>]*)>(\s*<\/zk-options>)?/gi, (_, attrs) => {
    for (const [, k, v] of attrs.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
      if (k === 'hold') {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= 10) options.hold = n;
        else findings.push({ severity: 'warn', rule: 'V010', message: `hold="${v}" は使えません。0〜10 の秒数を書いてください。` });
      } else if (OPTIONS[k]?.includes(v)) options[k] = v;
      else findings.push({ severity: 'warn', rule: 'V010', message: `<zk-options> の ${k}="${v}" は使えません。使えるのは ${Object.entries(OPTIONS).map(([n, vs]) => `${n}=${vs.join('|')}`).join('、')}、hold=秒数 です。` });
    }
    return '';
  });
  return { html: out, options, findings };
}

// AI が書いた <script> を、シーンごとの関数に包む。シーンどうしで変数がぶつからず、例外がどのシーンのものか分かる。
export const wrapScripts = (html, id) => html.replace(/<script>([\s\S]*?)<\/script>/gi, (_, code) => `<script>zk.__run(${id}, function () {\n${code.replace(/<\/script/gi, '<\\/script')}\n});</script>`);

const narrationOf = (blocks, ending = false) => {
  const b = blocks.find((x) => x.kind === 'narration' && Boolean(x.ending) === ending && Array.isArray(x.lines));
  return b ? b.lines : null;
};
const motionOf = (blocks, ending = false) => blocks.find((b) => b.kind === 'motion' && Boolean(b.ending) === ending);

// セクションの中のショットの役割。yaml narration と html motion の3つ目の語に書く。
export const ROLE_NAMES = { question: '疑問', answer: '答え', example: '例', term: '用語' };

// 台本は、オープニングでテーマと疑問を示し、各シーンで疑問を投げかけて根拠と例で答え、エンディングでまとめる。
export function scenesOf(source, file) {
  const doc = parse(source);
  const tokens = videoTokens(readJson('contract/tokens.json'));
  const limits = readJson('contract/limits.json');
  const ctx = { baseDir: path.dirname(path.resolve(file)) };
  const all = [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)];
  // 根拠と照らし合わせる原稿の文字列。ナレーションとシーンの HTML は除く。
  const rows = source.split('\n');
  const videoOnly = all.filter((b) => b.kind === 'narration' || b.kind === 'motion');
  const textOf = (from, to) => rows.slice(from - 1, to).filter((_, i) => !videoOnly.some((b) => from + i >= b.line && from + i <= b.endLine)).join('\n');
  const whole = textOf(1, rows.length);

  // シーンは AI が html motion で書く。書かれていないシーンは、代わりの自動の動きで出し、検査で知らせる。
  const missing = { severity: 'error', rule: 'V003', message: 'このシーンの html motion がありません。代わりの自動の動きで出しています。シーンを書いてください。' };
  const sceneOf = (motion) => (motion ? readOptions(motion.html) : { html: null, options: { ...DEFAULT_OPTIONS }, findings: [missing] });
  const linesOf = (list) => (list ?? []).map(parseLine);

  const leadLines = linesOf(narrationOf(doc.lead));
  const lead = sceneOf(motionOf(doc.lead));
  const opening = leadLines.length ? checkLines(leadLines, whole, { needQuestion: 'any' }) : [{ severity: 'error', rule: 'V004', message: 'オープニングのナレーションがありません。題名の直後の段落の後ろに yaml narration を置き、この動画のテーマと、動画で答える疑問を示してください。' }];
  const out = [{ opening: true, kind: lead.html == null ? 'title' : 'free', title: doc.title ?? '', heading: doc.title ?? '', claim: doc.title ?? '', figureSvg: null, whole: true, motionHtml: lead.html, options: lead.options, findings: [...opening, ...lead.findings], lines: leadLines, refsBlock: null }];

  const L = limits.video;
  for (const s of doc.sections) {
    if (s.container) continue;
    const fig = s.blocks.find((b) => b.kind === 'figure' && b.spec);
    const claim = s.blocks[0]?.kind === 'paragraph' ? s.blocks[0].text : s.title;
    const type = types[fig?.spec?.type];
    const figureSvg = type && !type.validate(fig.spec, limits, ctx).length ? type.render(fig.spec, tokens, ctx) : null;
    const refsBlock = s.blocks.find((b) => b.kind === 'refs') ?? null;
    // 図の代わりに表を置いたセクションは、表を動画にも出す。代わりの自動の動きと <zk-figure> で使う。
    const table = figureSvg ? null : s.blocks.find((b) => b.kind === 'table');
    const tableHtml = table ? tableMd.render(rows.slice(table.line - 1, table.endLine).join('\n')) : null;
    const sectionText = textOf(s.line, s.endLine);
    // 役割を付けたナレーションがあれば、ナレーション1つを1ショット（シーン）にする。無ければセクション全体で1シーン。
    const narrations = s.blocks.filter((b) => b.kind === 'narration' && !b.ending);
    const motions = s.blocks.filter((b) => b.kind === 'motion' && !b.ending);
    const shots = narrations.some((b) => b.role) ? narrations : [narrations[0] ?? null];
    const extra = narrations.some((b) => b.role) ? [] : narrations.slice(1);
    const used = new Set();
    shots.forEach((nb, k) => {
      const role = nb?.role ?? null;
      const findings = [];
      if (role && !ROLE_NAMES[role]) findings.push({ severity: 'warn', rule: 'V017', message: `役割「${role}」はありません。使える役割は ${Object.keys(ROLE_NAMES).join('、')} です。` });
      const motion = motions.find((m) => !used.has(m) && (m.role ?? null) === role);
      if (motion) used.add(motion);
      // 同じセクションの2つ目からのショットは、既定で切り替えの動きを付けずにつなぐ。
      const base = k > 0 ? { ...DEFAULT_OPTIONS, transition: 'cut' } : DEFAULT_OPTIONS;
      const opt = motion ? readOptions(motion.html, base) : { html: null, options: { ...base }, findings: [missing] };
      // ナレーションが無いセクションは、説明文を読み上げる。書き言葉のままになるので、代わりの手段にとどめる。
      const written = nb && Array.isArray(nb.lines) ? nb.lines : null;
      let lines = linesOf(written ?? (k === 0 ? sentences(s.blocks.slice(1).filter((b) => b.kind === 'paragraph').map((b) => b.text).join('')) : []));
      if (role === 'example') lines = lines.map((l) => ({ ...l, example: true }));
      if (written) findings.push(...checkLines(lines, sectionText, { needQuestion: k === 0 ? 'first' : null }));
      if (written && lines.length > L.maxShotLines) {
        findings.push({ severity: 'warn', rule: 'V107', message: role ? `このショットは${lines.length}行あります。目安は${L.maxShotLines}行までです。ショットを分けてください。` : `このシーンは${lines.length}行あります。目安は${L.maxShotLines}行までです。疑問（question）、答え（answer）、例（example）、用語（term）のショットに分けてください。` });
      }
      out.push({ kind: motion ? 'free' : 'auto', heading: role ? `${s.title}（${ROLE_NAMES[role] ?? role}）` : s.title, role, claim, figureSvg, whole: !type || WHOLE.has(fig.spec.type), tableHtml, motionHtml: opt.html, options: opt.options, findings: [...opt.findings, ...findings], lines, refsBlock });
    });
    for (const b of extra) {
      out.at(-1).findings.push({ severity: 'error', rule: 'V018', message: `L${b.line} の yaml narration は、このセクションの2つ目の役割の無いナレーションなので、動画に入りません。1つにまとめるか、役割（question、answer、example、term）を付けてショットに分けてください。` });
    }
    for (const m of motions.filter((x) => !used.has(x))) {
      out.at(-1).findings.push({ severity: 'warn', rule: 'V017', message: `L${m.line} の html motion${m.role ? ` ${m.role}` : ''} に、同じ役割の yaml narration がありません。` });
    }
  }

  // エンディング。原稿のどこに置いてもよいが、最後に置くと読みやすい。
  const endLines = linesOf(narrationOf(all, true));
  if (endLines.length) {
    const opt = sceneOf(motionOf(all, true));
    out.push({ ending: true, kind: opt.html == null ? 'title' : 'free', title: 'まとめ', heading: 'まとめ', claim: 'まとめ', figureSvg: null, whole: true, motionHtml: opt.html, options: opt.options, findings: [...opt.findings, ...checkLines(endLines, whole, {})], lines: endLines, refsBlock: null });
  } else {
    out[0].findings.push({ severity: 'error', rule: 'V005', message: 'エンディングがありません。原稿の最後に yaml narration ending と html motion ending を置き、動画の要点をまとめてください。' });
  }
  // 同じ書き出し（読点までの語）が多いと、聞いていて単調になる。動画全体で数える。
  const leads = {};
  out.forEach((sc, i) => sc.lines.forEach((l) => {
    const m = l.text.match(/^([^、。？！]{1,8})、/);
    if (m) (leads[m[1]] ??= []).push(i);
  }));
  for (const [w, ids] of Object.entries(leads)) {
    if (ids.length > L.maxSameLead) out[ids[0]].findings.push({ severity: 'warn', rule: 'V016', message: `「${w}、」で始まる行が${ids.length}回あります。${L.maxSameLead}回までにして、ほかは言い回しを変えるか、前置きなしで始めてください。` });
  }
  // 読めなかったナレーションは、そのシーンが黙って無音になるので、必ず知らせる。
  for (const b of all.filter((x) => x.kind === 'narration' && (x.parseError || !Array.isArray(x.lines)))) {
    out[0].findings.push({ severity: 'error', rule: 'V012', message: `L${b.line} の yaml narration を読めません。${b.parseError ?? '要素の配列にしてください。'} 「{」や「[」で始まる文は、引用符で囲んでください。` });
  }
  return out;
}

// 音声が無いときの長さの見積もり。文字数から1文ずつの長さを決める。
export function estimateVoice(lines) {
  let t = 0;
  const out = lines.map((l) => {
    const start = t;
    t += Math.max(0.8, l.text.length / TIMING.charsPerSec);
    const end = t;
    t += TIMING.lineGap;
    return { start, end };
  });
  return { duration: lines.length ? t - TIMING.lineGap : 0, lines: out, samples: null };
}

// シーンが入ってくるときの切り替えの長さ。cut は0秒。
export const transitionOf = (scene) => (scene.options.transition === 'cut' ? 0 : TIMING.transition);

// シーンを時間の上に並べる。シーンの間には、切り替えの時間を挟む。
export function timeline(scenes, voices) {
  const T = TIMING;
  let t = 0;
  const out = scenes.map((s, i) => {
    const v = voices[i];
    if (i > 0) t += transitionOf(s);
    const start = t;
    t += Math.max(T.minScene, T.narrStart + v.duration + T.tail) + s.options.hold;
    const lines = s.lines.map((l, j) => ({ text: l.text, example: l.example, start: v.lines[j].start, end: v.lines[j].end }));
    const markers = {};
    s.lines.forEach((l, j) => {
      for (const [k, idx] of Object.entries(l.marks)) markers[k] = T.narrStart + lines[j].start + (l.text.length ? idx / l.text.length : 0) * (lines[j].end - lines[j].start);
    });
    return { ...s, id: i, start, end: t, narrStart: T.narrStart, lines, markers, levels: v.levels ?? null };
  });
  return { scenes: out, duration: t + T.fadeOut, fadeOut: T.fadeOut };
}
