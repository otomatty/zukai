// Lint を続けて速く動かすための、常駐するプロセス。textlint と形態素解析の辞書を1回だけ読み込み、2回目からの zukai lint で使い回す。
// 最初の zukai lint は、いつもどおり自分で検査し、裏でこのプロセスを起動する。2回目からは、原稿をこのプロセスに渡して結果を受け取る。
// しばらく使われなければ終わる。zukai のコードや依存を入れ替えると接続先の名前が変わるので、古いプロセスは使われないまま終わる。
// このファイルは、接続する側（zukai lint）でも読む。重い依存（textlint など）は、常駐する側でだけ読み込む。
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, homeDir } from '../config.ts';
import type { LintResult } from './index.ts';

// 使われないまま、この時間がたったら終わる。
const IDLE_MS = 10 * 60 * 1000;
// つながるまで待つ上限。超えたら、自分で検査する。つながった後は、結果が返るまで待つ（出典の取得に時間がかかっても、同じ検査を2回しないため）。
const CONNECT_MS = 5 * 1000;

interface Request {
  // 本人だけが読めるファイルにある合言葉。ほかの利用者からの依頼を断るため。
  secret: string;
  source: string;
  file: string;
  textlint: boolean;
  cwd: string;
  // 呼んだ側の環境変数すべて。常駐する側が受け継いだ値ではなく、呼んだ側の値で検査するため。
  // 設定の変数だけでなく、検査が起動する git なども、呼んだ側の PATH や GIT_* で動かす。
  env: Record<string, string>;
}
type Response = { result: LintResult } | { error: string } | { denied: true };

// Node が起動するときにだけ読む環境変数。動いているプロセスの process.env を変えても効かない（出典を取りに行く HTTPS の証明書やプロキシなど）。
const startupEnv = (n: string) => /^(NODE|OPENSSL)_/.test(n) || /^(SSL_CERT_(FILE|DIR)|(HTTPS?|NO|ALL)_PROXY)$/i.test(n);

// 呼んだ側の Node のフラグ（--use-system-ca など）。常駐する側も同じフラグで起動し、接続先の名前にも含める。
// -e と -p は、続くコードを常駐する側で動かさないよう除く。
function nodeFlags(): string[] {
  const out: string[] = [];
  const args = process.execArgv;
  for (let i = 0; i < args.length; i++) {
    if (/^(-e|-p|--eval|--print)$/.test(args[i])) i++;
    else if (!/^--(eval|print)=/.test(args[i])) out.push(args[i]);
  }
  return out;
}

// 所属するグループ。newgrp などで違うグループから呼ばれたとき、読めるフォルダやファイルが違うので、別のプロセスにする。
const credentials = () => (windows ? '' : `${process.getegid!()}:${process.getgroups!().sort((x, y) => x - y).join(',')}`);

// 接続先の名前。zukai の場所、ホームのフォルダ、今いるフォルダ、umask（出典のキャッシュを書くときの権限）、所属するグループ、Node の本体と版とフラグ、起動するときにだけ読む環境変数、コードと依存の更新時刻から作る。
// 今いるフォルダを含めるのは、起動するときにだけ読む値の相対パス（NODE_EXTRA_CA_CERTS=./ca.pem など）を、呼んだ側と同じフォルダから読むため。
// ホームのフォルダが違えば設定（~/.zukai）が違うので、別のプロセスにする。Node や起動時の環境変数が違うときも、同じ結果にならないので別にする。
function versionKey(): string {
  const h = crypto.createHash('sha1').update(root).update('\0').update(os.homedir()).update(`\0${process.cwd()}\0${process.umask()}\0${credentials()}\0${process.execPath}\0${process.version}\0${JSON.stringify(nodeFlags())}`);
  for (const [n, v] of Object.entries(process.env).filter(([n]) => startupEnv(n)).sort(([a], [b]) => (a < b ? -1 : 1))) h.update(`\0${n}=${v}`);
  const add = (rel: string) => {
    try {
      const st = fs.statSync(path.join(root, rel));
      h.update(`\0${rel}:${st.mtimeMs}:${st.size}`);
    } catch {
      // 無いファイルは数えない。
    }
  };
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(path.join(rel, e.name));
      else add(path.join(rel, e.name));
    }
  };
  walk('src');
  walk('contract');
  // node_modules/.package-lock.json は、npm install のたびに書き直される。package-lock.json が同じまま入れ直したときも、別のプロセスにするため。
  for (const f of ['package.json', 'package-lock.json', 'node_modules/.package-lock.json', '.textlintrc.json']) add(f);
  return h.digest('hex').slice(0, 16);
}

// Windows では使わない。名前付きパイプの名前は、ほかの利用者が一覧で見られ、本人のプロセスが終わったあとに同じ名前で待ち受けられるため。
const windows = process.platform === 'win32';
const runDir = () => path.join(homeDir(), 'run');
const secretFile = () => path.join(runDir(), 'secret');

// 置き場所が本人のもので、ほかの利用者が書き込めないか。ほかの利用者が偽のソケットや合言葉を置けると、原稿や環境変数を渡してしまうため。
function privateDir(dir: string, create: boolean): boolean {
  try {
    if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const own = (p: string, loose: number) => {
      const st = fs.lstatSync(p);
      return st.isDirectory() && st.uid === process.getuid!() && (st.mode & loose) === 0;
    };
    // ~/.zukai は、ほかの利用者が書き込めないこと。run は、本人だけが入れること。先に作られていた run は、本人のものなら狭める。
    if (!own(homeDir(), 0o022)) return false;
    if (create && own(dir, 0) && !own(dir, 0o077)) fs.chmodSync(dir, 0o700);
    return own(dir, 0o077);
  } catch {
    return false;
  }
}

// 合言葉を読む。create なら、無ければ作る（常駐する側）。置き場所が安全でなければ null。
function readSecret(create: boolean): string | null {
  if (!privateDir(runDir(), create)) return null;
  const file = secretFile();
  try {
    if (create && !fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  } catch (e) {
    // ほかのプロセスが同時に作った。
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return null;
  }
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.uid !== process.getuid!() || (st.mode & 0o077) !== 0) return null;
    const secret = fs.readFileSync(file, 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

// 接続先。本人だけが入れるフォルダに置く Unix ソケット。
export const socketPath = (): string => path.join(runDir(), `lint-${versionKey()}.sock`);

// --- 接続する側 -------------------------------------------------------------

// 常駐するプロセスで検査する。使えなければ null を返し、裏で起動する。呼んだ側は、自分で検査する。
// 検査が例外を出したとき（設定の誤りなど）は、自分で検査したときと同じ文の例外にする。
export async function lintOnServer(source: string, file: string, { textlint = true } = {}): Promise<LintResult | null> {
  if (windows || process.env.ZUKAI_LINT_SERVER === 'off') return null;
  const secret = readSecret(false);
  if (!secret) {
    // 合言葉が無いのは、まだ一度も起動していないとき。置き場所が安全でないときは、常駐する側も起動しないので、自分で検査する。
    if (!fs.existsSync(secretFile())) start();
    return null;
  }
  const sock = socketPath();
  const req: Request = { secret, source, file, textlint, cwd: process.cwd(), env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)) };
  let res: Response;
  try {
    res = await send(sock, req);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // 常駐していない。次の検査から使えるよう、裏で起動する。
    if (code === 'ENOENT' || code === 'ECONNREFUSED') start();
    return null;
  }
  if ('denied' in res) return null;
  if ('error' in res) throw new Error(res.error);
  return res.result;
}

function send(sock: string, req: Request): Promise<Response> {
  return new Promise((ok, ng) => {
    const conn = net.connect(sock);
    let buf = '';
    conn.setEncoding('utf8');
    conn.setTimeout(CONNECT_MS, () => conn.destroy(Object.assign(new Error('常駐する検査のプロセスにつながりません。'), { code: 'ETIMEDOUT' })));
    conn.on('connect', () => {
      conn.setTimeout(0);
      conn.write(`${JSON.stringify(req)}\n`);
    });
    conn.on('data', (d: string) => (buf += d));
    conn.on('error', ng);
    conn.on('close', () => {
      try {
        ok(JSON.parse(buf) as Response);
      } catch {
        ng(Object.assign(new Error('常駐する検査のプロセスの応答を読めません。'), { code: 'EBADRESPONSE' }));
      }
    });
  });
}

function start(): void {
  const self = fileURLToPath(import.meta.url);
  spawn(process.execPath, [...nodeFlags(), self], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// --- 常駐する側 -------------------------------------------------------------

async function serve(): Promise<void> {
  // ソケットと合言葉は、本人だけが入れるフォルダに置く。置き場所が安全でなければ、常駐しない（呼んだ側が自分で検査する）。
  const secret = windows ? null : readSecret(true);
  if (!secret) process.exit(1);
  const sock = socketPath();
  // 起動するときに読む値は、もう読み終えた。呼んだ側のフォルダが消されても動き続けるよう、zukai のフォルダに移る。
  process.chdir(root);

  // 依頼は1つずつ処理する。依頼ごとに環境変数と今いるフォルダを、呼んだ側の値に切り替えるため。
  // 最初の依頼は、検査の準備（下の ready）ができるまで待つ。
  let lint: typeof import('./index.ts').lint;
  let ready!: () => void;
  let queue = new Promise<void>((ok) => (ready = ok));
  let timer: NodeJS.Timeout | undefined;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => server.close(() => process.exit(0)), IDLE_MS);
  };
  const handle = async (req: Request): Promise<Response> => {
    const saved = { ...process.env };
    const cwd = process.cwd();
    // 環境変数を、渡された値だけに入れ替える。渡されなかった変数は消す。
    const set = (env: NodeJS.ProcessEnv) => {
      for (const n of Object.keys(process.env)) if (!(n in env)) delete process.env[n];
      Object.assign(process.env, env);
    };
    try {
      set(req.env);
      process.chdir(req.cwd);
      return { result: await lint(req.source, req.file, { textlint: req.textlint }) };
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      set(saved);
      process.chdir(cwd);
    }
  };
  const server = net.createServer((conn) => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('error', () => {});
    conn.on('data', (d: string) => {
      buf += d;
      const end = buf.indexOf('\n');
      if (end < 0) return;
      const line = buf.slice(0, end);
      queue = queue.then(async () => {
        idle();
        let res: Response;
        try {
          const req = JSON.parse(line) as Request;
          // 合言葉が合わない依頼は、何も読まずに断る。
          const ok = typeof req.secret === 'string' && req.secret.length === secret.length && crypto.timingSafeEqual(Buffer.from(req.secret), Buffer.from(secret));
          res = ok ? await handle(req) : { denied: true };
        } catch (e) {
          res = { error: (e as Error).message };
        }
        conn.end(`${JSON.stringify(res)}\n`);
        idle();
      });
    });
  });
  await new Promise<void>((ok) => {
    server.once('error', async (e: NodeJS.ErrnoException) => {
      // 前のプロセスが残したソケットのファイル。応答が無ければ消して、もう一度待ち受ける。応答があれば、そちらに任せて終わる。
      if (e.code !== 'EADDRINUSE') process.exit(1);
      const alive = await new Promise<boolean>((r) => net.connect(sock).on('connect', function (this: net.Socket) { this.destroy(); r(true); }).on('error', () => r(false)));
      if (alive) process.exit(0);
      fs.rmSync(sock, { force: true });
      server.listen(sock, ok);
    });
    server.listen(sock, ok);
  });
  // 止められたときも、ソケットのファイルを消してから終わる。使われずに終わるときと同じく、close がファイルを消す。
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => server.close(() => process.exit(0)));
  idle();
  // 待ち受けてから、textlint と辞書を読み込む。同時にいくつ起動されても、重い準備をするのは待ち受けられた1つだけにするため（ほかは待ち受けられずに、すぐ終わる）。
  ({ lint } = await import('./index.ts'));
  await lint('# 準備\n\n準備です。\n', path.join(root, 'README.md')).catch(() => {});
  ready();
}

// 直接起動されたときだけ常駐する。import.meta.main は Node 24.2 からなので、起動したファイルと見比べる（package.json の engines は >=24）。
const entry = process.argv[1];
if (entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))) await serve();
