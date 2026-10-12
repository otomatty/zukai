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
import { root, homeDir, spec } from '../config.ts';
import type { LintResult } from './index.ts';

// 使われないまま、この時間がたったら終わる。
const IDLE_MS = 10 * 60 * 1000;
// 応答を待つ上限。超えたら、自分で検査する。
const WAIT_MS = 60 * 1000;

interface Request {
  // 本人だけが読めるファイルにある合言葉。ほかの利用者からの依頼を断るため。
  secret: string;
  source: string;
  file: string;
  textlint: boolean;
  cwd: string;
  // 設定に効く環境変数。常駐する側の環境変数ではなく、呼んだ側の値で検査するため。
  env: Record<string, string | undefined>;
}
type Response = { result: LintResult } | { error: string } | { denied: true };

// 接続先の名前。zukai の場所、ホームのフォルダ、コードと依存の更新時刻から作る。
// ホームのフォルダが違えば設定（~/.zukai）が違うので、別のプロセスにする。
function versionKey(): string {
  const h = crypto.createHash('sha1').update(root).update('\0').update(os.homedir());
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

const windows = process.platform === 'win32';
const runDir = () => path.join(homeDir(), 'run');
const secretFile = () => path.join(runDir(), 'secret');

// 置き場所が本人のもので、ほかの利用者が書き込めないか。ほかの利用者が偽のソケットや合言葉を置けると、原稿や環境変数を渡してしまうため。
// Windows は、ホームのフォルダの権限で守られる（Node からは確かめられない）。
function privateDir(dir: string, create: boolean): boolean {
  if (windows) {
    if (create) fs.mkdirSync(dir, { recursive: true });
    return fs.existsSync(dir);
  }
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
    if (!st.isFile() || (!windows && (st.uid !== process.getuid!() || (st.mode & 0o077) !== 0))) return null;
    const secret = fs.readFileSync(file, 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

// 接続先。Windows の名前付きパイプは、だれでも同じ名前で先に作れるので、名前に合言葉を混ぜて、ほかの利用者に分からないようにする。
export function socketPath(secret: string): string {
  const key = versionKey();
  return windows ? `\\\\.\\pipe\\zukai-lint-${crypto.createHash('sha256').update(secret).update(key).digest('hex').slice(0, 32)}` : path.join(runDir(), `lint-${key}.sock`);
}

// 設定に効く環境変数の名前。contract/settings.json の env。
const envNames = (): string[] => Object.values(spec).flatMap((s) => (s.env ? [s.env] : []));

// --- 接続する側 -------------------------------------------------------------

// 常駐するプロセスで検査する。使えなければ null を返し、裏で起動する。呼んだ側は、自分で検査する。
// 検査が例外を出したとき（設定の誤りなど）は、自分で検査したときと同じ文の例外にする。
export async function lintOnServer(source: string, file: string, { textlint = true } = {}): Promise<LintResult | null> {
  if (process.env.ZUKAI_LINT_SERVER === 'off') return null;
  const secret = readSecret(false);
  if (!secret) {
    // 合言葉が無いのは、まだ一度も起動していないとき。置き場所が安全でないときは、常駐する側も起動しないので、自分で検査する。
    if (!fs.existsSync(secretFile())) start();
    return null;
  }
  const sock = socketPath(secret);
  const req: Request = { secret, source, file, textlint, cwd: process.cwd(), env: Object.fromEntries(envNames().map((n) => [n, process.env[n]])) };
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
    conn.setTimeout(WAIT_MS, () => conn.destroy(Object.assign(new Error('常駐する検査のプロセスが応答しません。'), { code: 'ETIMEDOUT' })));
    conn.on('connect', () => conn.write(`${JSON.stringify(req)}\n`));
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
  spawn(process.execPath, [self], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
}

// --- 常駐する側 -------------------------------------------------------------

async function serve(): Promise<void> {
  // ソケットと合言葉は、本人だけが入れるフォルダに置く。置き場所が安全でなければ、常駐しない（呼んだ側が自分で検査する）。
  const secret = readSecret(true);
  if (!secret) process.exit(1);
  const sock = socketPath(secret);
  const { lint } = await import('./index.ts');
  // 辞書を読み込んでおく。最初の依頼から速く返すため。
  await lint('# 準備\n\n準備です。\n', path.join(root, 'README.md')).catch(() => {});

  // 依頼は1つずつ処理する。依頼ごとに環境変数と今いるフォルダを、呼んだ側の値に切り替えるため。
  let queue = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => server.close(() => process.exit(0)), IDLE_MS);
  };
  const handle = async (req: Request): Promise<Response> => {
    const saved = Object.fromEntries(Object.keys(req.env).map((n) => [n, process.env[n]]));
    const cwd = process.cwd();
    const set = (env: Record<string, string | undefined>) => {
      for (const [n, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
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
}

if (import.meta.main) await serve();
