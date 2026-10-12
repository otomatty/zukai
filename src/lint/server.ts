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
  source: string;
  file: string;
  textlint: boolean;
  cwd: string;
  // 設定に効く環境変数。常駐する側の環境変数ではなく、呼んだ側の値で検査するため。
  env: Record<string, string | undefined>;
}
type Response = { result: LintResult } | { error: string };

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
  for (const f of ['package.json', 'package-lock.json', '.textlintrc.json']) add(f);
  return h.digest('hex').slice(0, 16);
}

export function socketPath(): string {
  const key = versionKey();
  return process.platform === 'win32' ? `\\\\.\\pipe\\zukai-lint-${crypto.createHash('sha1').update(os.userInfo().username).digest('hex').slice(0, 8)}-${key}` : path.join(homeDir(), 'run', `lint-${key}.sock`);
}

// 設定に効く環境変数の名前。contract/settings.json の env。
const envNames = (): string[] => Object.values(spec).flatMap((s) => (s.env ? [s.env] : []));

// --- 接続する側 -------------------------------------------------------------

// 常駐するプロセスで検査する。使えなければ null を返し、裏で起動する。呼んだ側は、自分で検査する。
// 検査が例外を出したとき（設定の誤りなど）は、自分で検査したときと同じ文の例外にする。
export async function lintOnServer(source: string, file: string, { textlint = true } = {}): Promise<LintResult | null> {
  if (process.env.ZUKAI_LINT_SERVER === 'off') return null;
  const sock = socketPath();
  const req: Request = { source, file, textlint, cwd: process.cwd(), env: Object.fromEntries(envNames().map((n) => [n, process.env[n]])) };
  let res: Response;
  try {
    res = await send(sock, req);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // 常駐していない。次の検査から使えるよう、裏で起動する。
    if (code === 'ENOENT' || code === 'ECONNREFUSED') start();
    return null;
  }
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
  const sock = socketPath();
  // ソケットは、本人だけが入れるフォルダに置く。ほかの利用者が、検査を頼めないようにするため。
  if (process.platform !== 'win32') fs.mkdirSync(path.dirname(sock), { recursive: true, mode: 0o700 });
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
          res = await handle(JSON.parse(line) as Request);
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
  idle();
}

if (import.meta.main) await serve();
