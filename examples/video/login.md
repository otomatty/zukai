# ログイン機能のしくみ

この資料は、動画の出力を試すためのサンプルです。社内向け管理画面のログイン機能について、要求の経路、やり取り、有効期限、構成を説明します。

```yaml narration
- ログインのボタンを{#tap}押すと、すぐに画面が切り替わります。
- text: でも、そのほんの一瞬に、<short pause>{#behind}裏では何が起きているのでしょう？
  style: 少し声をひそめて、興味をそそるように
- この動画では、ログインのしくみを、4つの疑問から順に見ていきます。
```

```html motion
<zk-options transition="fade"></zk-options>
<style>
.op-bg{position:absolute;inset:0;background:linear-gradient(#121a36,#1f2d5c)}
.op-title{position:absolute;left:0;right:0;top:80px;text-align:center;color:var(--zk-white);font:800 76px var(--zk-font);animation:op-in .7s cubic-bezier(.2,.8,.3,1.4) .2s both}
.op-shadow{position:absolute;left:634px;top:300px;width:700px;height:520px;border-radius:36px;background:#0c1330;animation:op-in .7s cubic-bezier(.2,.8,.3,1.4) .5s both}
.op-win{position:absolute;left:610px;top:276px;width:700px;height:520px;border-radius:36px;background:#f5f7ff;overflow:hidden;animation:op-in .7s cubic-bezier(.2,.8,.3,1.4) .5s both}
.op-bar{position:absolute;left:0;right:0;top:0;height:70px;background:#c9d4f2}
.op-dot{position:absolute;top:24px;width:22px;height:22px;border-radius:50%}
.op-field{position:absolute;left:90px;width:520px;height:66px;border-radius:18px;background:#dfe6f7}
.op-field::after{content:"";position:absolute;left:24px;top:22px;width:var(--w);height:22px;border-radius:11px;background:#aab8dc}
.op-btn{position:absolute;left:190px;top:384px;width:320px;height:86px;border-radius:43px;background:var(--zk-yellow);box-shadow:0 10px 0 #d99a1a;color:#1c2b52;font:800 40px var(--zk-font);display:flex;align-items:center;justify-content:center;animation:op-press .3s ease-in-out var(--tap) both}
.op-cur{position:absolute;left:0;top:0;width:70px;height:90px;animation:op-move 1.1s cubic-bezier(.5,0,.3,1) calc(var(--tap) - 1.1s) both}
.op-q{position:absolute;width:120px;height:120px;border-radius:50%;color:#1c2b52;font:800 70px var(--zk-font);display:flex;align-items:center;justify-content:center;animation:op-pop .55s cubic-bezier(.2,.8,.3,1.5) var(--d) both,op-float 2.4s ease-in-out calc(var(--d) + .55s) infinite}
@keyframes op-in{from{transform:scale(.6);opacity:0}}
@keyframes op-press{50%{transform:translateY(8px);box-shadow:0 2px 0 #d99a1a}}
@keyframes op-move{from{transform:translate(1560px,980px) rotate(-20deg)}to{transform:translate(952px,700px)}}
@keyframes op-pop{from{transform:scale(0)}}
@keyframes op-float{50%{translate:0 -16px}}
</style>
<div class="op-bg"></div>
<div class="op-title" data-sfx="chime">ログイン機能のしくみ</div>
<div class="op-shadow"></div>
<div class="op-win">
  <div class="op-bar"><div class="op-dot" style="left:30px;background:var(--zk-red)"></div><div class="op-dot" style="left:66px;background:var(--zk-yellow)"></div><div class="op-dot" style="left:102px;background:var(--zk-green)"></div></div>
  <div class="op-field" style="top:130px;--w:180px"></div>
  <div class="op-field" style="top:230px;--w:120px"></div>
  <div class="op-btn">ログイン</div>
</div>
<svg class="op-cur" viewBox="0 0 70 90"><path d="M4 4 L4 70 L22 54 L34 84 L48 78 L36 50 L60 50 Z" fill="#fff" stroke="#1c2b52" stroke-width="6" stroke-linejoin="round"/></svg>
<div class="op-q" data-sfx="pop" style="left:400px;top:300px;background:var(--zk-cyan);--d:var(--behind)">?</div>
<div class="op-q" data-sfx="pop" style="left:1400px;top:280px;background:var(--zk-pink);--d:calc(var(--behind) + .2s)">?</div>
<div class="op-q" data-sfx="pop" style="left:1430px;top:620px;background:var(--zk-green);--d:calc(var(--behind) + .4s)">?</div>
<div class="op-q" data-sfx="pop" style="left:370px;top:640px;background:var(--zk-orange);--d:calc(var(--behind) + .6s)">?</div>
```

## ログイン要求の経路

ログイン要求は、ゲートウェイ、認証サービス、セッションDBの順に通ります。

```yaml figure
type: flow
steps:
  - label: ゲートウェイ
    note: 要求を受け付ける
  - label: 認証サービス
    note: パスワードを照合する
    emphasis: true
  - label: セッションDB
    note: 30分間保存する
```

認証サービスは、照合に成功するとセッションIDを発行します。

```yaml narration
- ボタンを押したあと、パスワードは、どこへ運ばれるのでしょう？
- 最初に届くのは、{#gw}ゲートウェイという入口です。
- ゲートウェイとは、外からの要求をまとめて受け付ける窓口のことです。
- text: たとえば、会社の受付が来客を受け付けて、担当の部署へ案内するのと同じです。
  example: true
- 担当は{#auth}認証サービスで、パスワードが{#check}正しいかを照合します。
- 正しければ、{#db}セッションDBに、ログインした印を30分間しまいます。
```

```html motion
<style>
.fl-bg{position:absolute;inset:0;background:linear-gradient(#0f1e3d,#1b3366)}
.fl-road{position:absolute;left:120px;top:640px;width:1680px;height:18px;border-radius:9px;background:#2c4a8a}
.fl-st{position:absolute;top:340px;width:300px;height:300px;transform-origin:50% 100%;animation:fl-pop .6s cubic-bezier(.2,.8,.3,1.4) var(--at) both}
.fl-name{position:absolute;top:690px;width:400px;text-align:center;color:var(--zk-white);font:800 42px var(--zk-font);animation:fl-fade .4s ease-out calc(var(--at) + .2s) both}
.fl-ok{position:absolute;left:1010px;top:300px;width:110px;height:110px;animation:fl-pop .5s cubic-bezier(.2,.8,.3,1.6) var(--check) both}
.fl-env,.fl-chip{position:absolute;left:0;top:0}
@keyframes fl-pop{from{transform:scale(0)}}
@keyframes fl-fade{from{opacity:0;transform:translateY(16px)}}
</style>
<div class="fl-bg"></div>
<div class="fl-road"></div>
<svg class="fl-st" data-sfx="pop" style="left:270px;--at:calc(var(--gw) - .9s)" viewBox="0 0 300 300">
  <rect x="40" y="70" width="60" height="230" rx="10" fill="#3ec1d3"/><rect x="200" y="70" width="60" height="230" rx="10" fill="#3ec1d3"/>
  <rect x="80" y="70" width="20" height="230" fill="#2a98a8"/><rect x="240" y="70" width="20" height="230" fill="#2a98a8"/>
  <path d="M20 90 Q150 -10 280 90 L280 120 Q150 30 20 120 Z" fill="#ffc94a"/>
</svg>
<div class="fl-name" style="left:220px;--at:calc(var(--gw) - .9s)">ゲートウェイ</div>
<svg class="fl-st" data-sfx="pop" style="left:810px;--at:calc(var(--auth) - .3s)" viewBox="0 0 300 300">
  <path d="M150 20 L270 60 L260 170 Q240 260 150 300 Q60 260 40 170 L30 60 Z" fill="#7b5ce1"/>
  <path d="M150 20 L270 60 L260 170 Q240 260 150 300 Z" fill="#6447c4"/>
  <circle cx="150" cy="140" r="34" fill="#ffc94a"/><rect x="136" y="150" width="28" height="70" rx="10" fill="#ffc94a"/>
</svg>
<div class="fl-name" style="left:760px;--at:calc(var(--auth) - .3s)">認証サービス</div>
<svg class="fl-ok" viewBox="0 0 110 110" data-sfx="chime"><circle cx="55" cy="55" r="55" fill="#3cc48a"/><path d="M30 57 L48 74 L80 38" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>
<svg class="fl-st" data-sfx="pop" style="left:1350px;--at:calc(var(--db) - .3s)" viewBox="0 0 300 300">
  <rect x="50" y="80" width="200" height="200" fill="#ff8a3d"/><rect x="150" y="80" width="100" height="200" fill="#e26f25"/>
  <ellipse cx="150" cy="280" rx="100" ry="26" fill="#e26f25"/>
  <ellipse cx="150" cy="150" rx="100" ry="26" fill="#ffa868" opacity=".5"/>
  <ellipse cx="150" cy="80" rx="100" ry="26" fill="#ffc94a"/>
</svg>
<div class="fl-name" style="left:1300px;--at:calc(var(--db) - .3s)">セッションDB</div>
<svg class="fl-env" width="100" height="70" viewBox="0 0 100 70"><rect width="100" height="70" rx="8" fill="#f5f7ff"/><path d="M0 6 L50 42 L100 6" fill="none" stroke="#aab8dc" stroke-width="7" stroke-linejoin="round"/></svg>
<svg class="fl-chip" width="110" height="60" viewBox="0 0 110 60"><rect width="110" height="60" rx="16" fill="#ffc94a"/><text x="55" y="42" text-anchor="middle" font-size="32" font-weight="800" fill="#1c2b52">ID</text></svg>
<script>
const root = document.currentScript.closest('.zk-scene');
const sec = (n) => parseFloat(getComputedStyle(root).getPropertyValue('--' + n));
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const clamp = (v) => Math.max(0, Math.min(1, v));
// 手紙の通り道。[時刻, x] の組を順にたどる。
const path = (t, keys) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * ease((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  return keys.at(-1)[1];
};
zk.cue('whoosh', sec('gw') - 0.9, { dur: 0.9 });
zk.cue('whoosh', sec('auth') - 0.8, { dur: 0.8 });
zk.cue('whoosh', sec('db'), { dur: 0.9 });
zk.scene((t, el) => {
  const gw = sec('gw'), auth = sec('auth'), db = sec('db');
  const x = path(t, [[gw - 0.9, -160], [gw, 420], [auth - 0.8, 420], [auth, 960]]);
  const env = el.querySelector('.fl-env');
  env.style.transform = `translate(${x - 50}px, ${470 + Math.sin(t * 7) * 6}px) rotate(${Math.sin(t * 7) * 4}deg)`;
  env.style.opacity = t < db ? 1 : 0;
  const p = clamp((t - db) / 0.9);
  const chip = el.querySelector('.fl-chip');
  chip.style.opacity = p > 0 && p < 1 ? 1 : 0;
  chip.style.transform = `translate(${960 + 540 * ease(p) - 55}px, ${450 - Math.sin(Math.PI * p) * 180}px)`;
});
</script>
```

## ログイン時のやり取り

ブラウザは、認証サービスからCookieを受け取った時点でログイン済みになります。

```yaml figure
type: sequence
actors: [ブラウザ, 認証サービス, セッションDB]
messages:
  - from: ブラウザ
    to: 認証サービス
    label: IDとパスワード
  - from: 認証サービス
    to: セッションDB
    label: セッションID
  - from: 認証サービス
    to: ブラウザ
    label: Cookie
    reply: true
```

Cookieには、セッションIDだけを入れます。

```yaml narration
- では、ブラウザは、ログインしたことをどうやって覚えておくのでしょう？
- やり取りに出てくるのは、{#b}ブラウザ、{#a}認証サービス、{#d}セッションDBの3つです。
- まずブラウザが、{#send}IDとパスワードを送ります。
- 認証サービスは、セッションIDを作って、{#store}セッションDBにしまいます。
- セッションIDとは、ログインしたことを示す、合言葉のようなものです。
- そして、その合言葉を{#cookie}クッキーに入れて、ブラウザに返します。
- クッキーとは、ブラウザが預かっておく、小さなメモのことです。
- text: たとえば、遊園地の再入場スタンプのように、次からはこれを見せるだけで入れます。
  example: true
```

```html motion
<style>
.sq-bg{position:absolute;inset:0;background:linear-gradient(#1a1440,#2b1f63)}
.sq-ch{position:absolute;top:360px;width:320px;height:320px;transform-origin:50% 100%;animation:sq-pop .6s cubic-bezier(.2,.8,.3,1.5) var(--at) both}
.sq-name{position:absolute;top:720px;width:420px;text-align:center;color:var(--zk-white);font:800 40px var(--zk-font);animation:sq-fade .4s ease-out calc(var(--at) + .2s) both}
.sq-msg{position:absolute;left:0;top:0;padding:14px 30px;border-radius:40px;font:800 34px var(--zk-font);white-space:nowrap;opacity:0}
.sq-done{position:absolute;left:470px;top:330px;width:100px;height:100px;animation:sq-pop .5s cubic-bezier(.2,.8,.3,1.6) calc(var(--cookie) + 1s) both}
@keyframes sq-pop{from{transform:scale(0)}}
@keyframes sq-fade{from{opacity:0;transform:translateY(16px)}}
</style>
<div class="sq-bg"></div>
<svg class="sq-ch" data-sfx="pop" style="left:200px;--at:var(--b)" viewBox="0 0 320 320">
  <rect x="20" y="70" width="280" height="220" rx="28" fill="#4fb3f0"/><rect x="160" y="70" width="140" height="220" rx="28" fill="#3a98d6"/>
  <rect x="20" y="70" width="280" height="50" rx="24" fill="#2f6fde"/>
  <g class="sq-eyes"><circle cx="115" cy="190" r="26" fill="#fff"/><circle cx="205" cy="190" r="26" fill="#fff"/><circle cx="122" cy="194" r="12" fill="#1c2b52"/><circle cx="212" cy="194" r="12" fill="#1c2b52"/></g>
  <path class="sq-smile" d="M125 245 Q160 260 195 245" fill="none" stroke="#1c2b52" stroke-width="9" stroke-linecap="round"/>
</svg>
<div class="sq-name" style="left:150px;--at:var(--b)">ブラウザ</div>
<svg class="sq-ch" data-sfx="pop" style="left:800px;--at:var(--a)" viewBox="0 0 320 320">
  <rect x="155" y="30" width="10" height="60" fill="#c9d4f2"/><circle cx="160" cy="30" r="18" fill="#ffc94a"/>
  <circle cx="160" cy="190" r="125" fill="#7b5ce1"/><path d="M160 65 A125 125 0 0 1 160 315 Z" fill="#6447c4"/>
  <g class="sq-eyes"><circle cx="118" cy="180" r="28" fill="#fff"/><circle cx="202" cy="180" r="28" fill="#fff"/><circle cx="124" cy="184" r="13" fill="#1c2b52"/><circle cx="208" cy="184" r="13" fill="#1c2b52"/></g>
  <rect x="125" y="240" width="70" height="14" rx="7" fill="#1c2b52"/>
</svg>
<div class="sq-name" style="left:750px;--at:var(--a)">認証サービス</div>
<svg class="sq-ch" data-sfx="pop" style="left:1400px;--at:var(--d)" viewBox="0 0 320 320">
  <rect x="50" y="90" width="220" height="200" fill="#ff8a3d"/><rect x="160" y="90" width="110" height="200" fill="#e26f25"/>
  <ellipse cx="160" cy="290" rx="110" ry="28" fill="#e26f25"/><ellipse cx="160" cy="90" rx="110" ry="28" fill="#ffc94a"/>
  <g class="sq-eyes"><circle cx="120" cy="190" r="26" fill="#fff"/><circle cx="200" cy="190" r="26" fill="#fff"/><circle cx="126" cy="194" r="12" fill="#1c2b52"/><circle cx="206" cy="194" r="12" fill="#1c2b52"/></g>
</svg>
<div class="sq-name" style="left:1350px;--at:var(--d)">セッションDB</div>
<div class="sq-msg" id="sq-id" style="background:#f5f7ff;color:#1c2b52">IDとパスワード</div>
<div class="sq-msg" id="sq-sid" style="background:var(--zk-yellow);color:#1c2b52">セッションID</div>
<svg class="sq-msg" id="sq-cookie" style="padding:0" width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="52" fill="#d9a066"/><circle cx="55" cy="55" r="52" fill="none" stroke="#b97f45" stroke-width="8"/><circle cx="35" cy="40" r="9" fill="#5b3a1e"/><circle cx="70" cy="35" r="7" fill="#5b3a1e"/><circle cx="62" cy="72" r="10" fill="#5b3a1e"/><circle cx="32" cy="74" r="6" fill="#5b3a1e"/></svg>
<svg class="sq-done" viewBox="0 0 100 100" data-sfx="chime"><circle cx="50" cy="50" r="50" fill="#3cc48a"/><path d="M27 52 L44 68 L74 34" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>
<script>
const root = document.currentScript.closest('.zk-scene');
const sec = (n) => parseFloat(getComputedStyle(root).getPropertyValue('--' + n));
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const clamp = (v) => Math.max(0, Math.min(1, v));
const flights = [
  ['#sq-id', 'send', 360, 960],
  ['#sq-sid', 'store', 960, 1560],
  ['#sq-cookie', 'cookie', 960, 360],
];
for (const [, at] of flights) zk.cue('whoosh', sec(at), { dur: 1 });
zk.scene((t, el) => {
  // 手紙は、弧を描いて相手のところへ飛び、着いたら消える。
  for (const [sel, at, x0, x1] of flights) {
    const m = el.querySelector(sel);
    const p = clamp((t - sec(at)) / 1);
    const x = x0 + (x1 - x0) * ease(p);
    const y = 300 - Math.sin(Math.PI * p) * 120;
    m.style.opacity = p > 0 && p < 1 ? 1 : 0;
    m.style.transform = `translate(calc(${x}px - 50%), ${y}px) rotate(${(x1 > x0 ? 1 : -1) * Math.sin(Math.PI * p) * 8}deg)`;
  }
  // まばたき。3体がそれぞれの間隔で目を閉じる。
  el.querySelectorAll('.sq-eyes').forEach((g, i) => {
    const ph = (t * (0.31 + i * 0.07) + i * 0.4) % 1;
    g.style.transformBox = 'fill-box';
    g.style.transformOrigin = 'center';
    g.style.transform = `scaleY(${ph < 0.05 ? 0.15 : 1})`;
  });
  // クッキーを受け取ったブラウザは、大きく笑う。
  const happy = clamp((t - sec('cookie') - 1) / 0.3);
  el.querySelector('.sq-smile').setAttribute('d', `M125 245 Q160 ${260 + happy * 30} 195 245`);
});
</script>
```

## セッションの有効期限

セッションIDは、最後の操作から30分が過ぎると削除されます。

```yaml figure
type: flow
steps:
  - label: ログイン
  - label: 最後の操作
  - label: 30分後に削除
    emphasis: true
```

操作が続いている間は、30分の数え始めが後ろにずれます。

```yaml refs
- quote: "Common idle timeouts ranges are 2-5 minutes for high-value applications and 15-30 minutes for low risk applications."
  ja: 一般的なアイドルタイムアウトの範囲は、価値の高いアプリケーションで2〜5分、リスクの低いアプリケーションで15〜30分です。
  source: OWASP Session Management Cheat Sheet「Idle Timeout」
  url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#idle-timeout
  license: CC BY-SA 4.0
  snapshot: ../../corpus/fixtures/sources/owasp-idle-timeout.txt
```

```yaml narration
- その合言葉は、いつまで使えるのでしょう？
- ログインすると、{#issue}セッションIDが渡されます。
- そして、最後に操作したときから、{#clock}時計が動き出します。
- text: そのまま30分たつと、<short pause>{#expire}合言葉は消えてしまいます。
  style: 少し声を落として
- では、なぜ30分なのでしょう？
- '{#ref}セキュリティのガイドラインでは、リスクの低いアプリの目安を、15分から30分としています。'
- text: たとえば、昼休みに席を離れて戻ってきたら、もう一度ログインが必要になります。
  example: true
```

```html motion
<zk-options transition="zoom" hold="0.8"></zk-options>
<style>
.ex-bg{position:absolute;inset:0;background:linear-gradient(#1b2a52,#24396b)}
.ex-clock{position:absolute;left:360px;top:200px;width:560px;height:560px;overflow:visible}
.ex-face{transform-box:fill-box;transform-origin:center;animation:ex-in .55s cubic-bezier(.2,.8,.3,1.4) var(--clock) both}
.ex-hand{transform-box:view-box;transform-origin:280px 280px;animation:ex-turn 2.6s cubic-bezier(.5,0,.5,1) calc(var(--clock) + .5s) both}
.ex-out{position:absolute;left:1080px;top:360px;width:560px;height:240px;animation:ex-gone .6s ease-in calc(var(--expire) + .15s) forwards}
.ex-shadow{position:absolute;left:18px;top:22px;width:100%;height:100%;border-radius:34px;background:#121c3d;animation:ex-in .55s cubic-bezier(.2,.8,.3,1.4) var(--issue) both}
.ex-card{position:absolute;inset:0;border-radius:34px;background:var(--zk-purple);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font:800 54px var(--zk-font);animation:ex-in .55s cubic-bezier(.2,.8,.3,1.4) var(--issue) both}
.ex-card small{font-size:32px;font-weight:700;opacity:.75;margin-top:12px;letter-spacing:.08em}
@keyframes ex-in{from{transform:scale(.3);opacity:0}to{transform:none;opacity:1}}
@keyframes ex-turn{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes ex-gone{40%{transform:translateY(-16px) rotate(4deg)}to{transform:scale(.15) rotate(-20deg);opacity:0}}
.ex-ref{position:absolute;left:1000px;top:250px;width:760px;padding:28px 34px;border-radius:26px;background:#f5f7ff;color:#1c2b52;font:700 32px/1.5 var(--zk-font);animation:ex-in .55s cubic-bezier(.2,.8,.3,1.4) var(--ref) both}
.ex-ref b{display:block;margin-bottom:10px;color:#7b5ce1;font-size:26px}
.ex-ref .ex-src{display:block;margin-top:14px;font-size:24px;color:#5b6673}
.ex-eg{position:absolute;left:1000px;top:640px;padding:14px 30px;border-radius:40px;background:var(--zk-yellow);color:#1c2b52;font:800 34px var(--zk-font);opacity:0}
</style>
<div class="ex-bg"></div>
<svg class="ex-clock" viewBox="0 0 560 560">
  <g class="ex-face" data-sfx="pop">
    <circle cx="300" cy="300" r="250" fill="#121c3d"/>
    <circle cx="280" cy="280" r="250" fill="#ffc94a"/>
    <circle cx="280" cy="280" r="214" fill="#f5f7ff"/>
    <path d="M280 66 A214 214 0 0 1 280 494 Z" fill="#e3e9f8"/>
    <g fill="#1c2b52">
      <rect x="272" y="84" width="16" height="36" rx="8"/><rect x="272" y="440" width="16" height="36" rx="8"/>
      <rect x="84" y="272" width="36" height="16" rx="8"/><rect x="440" y="272" width="36" height="16" rx="8"/>
    </g>
    <text x="280" y="400" text-anchor="middle" fill="#1c2b52" font-size="64" font-weight="800">30分</text>
    <g class="ex-hand"><rect x="268" y="110" width="24" height="182" rx="12" fill="#ef4b5f"/><circle cx="280" cy="280" r="26" fill="#1c2b52"/></g>
  </g>
</svg>
<div class="ex-out" data-sfx="whoosh"><div class="ex-shadow"></div><div class="ex-card" data-sfx="pop">セッションID<small>a3f9-27c1</small></div></div>
<div class="ex-ref" data-sfx="pop"><b>根拠</b><span class="ex-ja"></span><span class="ex-src"></span></div>
<div class="ex-eg">たとえば、昼休みに席を離れたら…</div>
<script>
// 根拠の札には、原稿の yaml refs の引用を、そのまま出す。
const root = document.currentScript.closest('.zk-scene');
const ref = zk.refs().find((r) => r.kind === 'quote');
if (ref) {
  root.querySelector('.ex-ja').textContent = ref.ja ?? ref.quote;
  root.querySelector('.ex-src').textContent = `出典: ${ref.source}`;
}
// 例を話している間だけ、「たとえば」の札を出す。
zk.scene((t, el, info) => {
  el.querySelector('.ex-eg').style.opacity = info.example ? 1 : 0;
});
</script>
```

## 構成

ログイン機能は、画面、API、保存先の3層で構成します。

```yaml figure
type: layers
layers:
  - label: 画面
    items: [ログイン画面, 設定画面]
  - label: API
    items: [認証API, 利用者API]
  - label: 保存先
    items: [利用者DB, セッションDB]
```

ログイン画面と設定画面は、認証APIと利用者APIだけを呼び出します。

```yaml narration
- 画面が、保存先に直接聞きに行ってはいけないのでしょうか？
- ログイン機能は、3つの層に分かれています。
- いちばん上が{#ui}画面、その下に{#api}API、いちばん下が{#store}保存先です。
- APIとは、画面と保存先のあいだに立つ、窓口のことです。
- 画面が直接、{#no}保存先にさわることはありません。必ず窓口を通します。
- text: たとえば、銀行の金庫には、お客さんではなく、窓口の係だけが入れるのと同じです。
  example: true
```

```html motion
<style>
.ly-bg{position:absolute;inset:0;background:linear-gradient(#0f2233,#16405a)}
.ly-slab{position:absolute;left:420px;width:900px;height:150px;animation:ly-drop .7s cubic-bezier(.3,1.4,.5,1) var(--at) both}
.ly-top{position:absolute;inset:0 0 26px 0;border-radius:28px;background:var(--c)}
.ly-side{position:absolute;left:0;right:0;bottom:0;height:60px;border-radius:0 0 28px 28px;background:var(--d)}
.ly-name{position:absolute;left:40px;top:34px;color:#fff;font:800 48px var(--zk-font)}
.ly-tag{position:absolute;top:34px;padding:8px 22px;border-radius:24px;background:rgba(255,255,255,.9);color:#1c2b52;font:800 30px var(--zk-font)}
.ly-no{position:absolute;left:1390px;top:200px;width:200px;height:560px;overflow:visible}
.ly-line{stroke-dasharray:1;stroke-dashoffset:1;animation:ly-draw .7s ease-in-out var(--no) forwards}
.ly-x{transform-box:fill-box;transform-origin:center;animation:ly-pop .5s cubic-bezier(.2,.8,.3,1.6) calc(var(--no) + .6s) both}
@keyframes ly-drop{from{transform:translateY(-420px);opacity:0}}
@keyframes ly-draw{to{stroke-dashoffset:0}}
@keyframes ly-pop{from{transform:scale(0)}}
</style>
<div class="ly-bg"></div>
<div class="ly-slab" data-sfx="pop" style="top:200px;--at:calc(var(--ui) - .2s);--c:var(--zk-cyan);--d:#2a98a8"><div class="ly-side"></div><div class="ly-top"><div class="ly-name">画面</div><div class="ly-tag" style="left:380px">ログイン画面</div><div class="ly-tag" style="left:640px">設定画面</div></div></div>
<div class="ly-slab" data-sfx="pop" style="top:400px;--at:calc(var(--api) - .2s);--c:var(--zk-purple);--d:#5b40b8"><div class="ly-side"></div><div class="ly-top"><div class="ly-name">API</div><div class="ly-tag" style="left:380px">認証API</div><div class="ly-tag" style="left:640px">利用者API</div></div></div>
<div class="ly-slab" data-sfx="pop" style="top:600px;--at:calc(var(--store) - .2s);--c:var(--zk-orange);--d:#d0661f"><div class="ly-side"></div><div class="ly-top"><div class="ly-name">保存先</div><div class="ly-tag" style="left:380px">利用者DB</div><div class="ly-tag" style="left:640px">セッションDB</div></div></div>
<svg class="ly-no" viewBox="0 0 200 560">
  <path class="ly-line" pathLength="1" data-sfx="draw" d="M40 60 Q170 280 40 480" fill="none" stroke="#ef4b5f" stroke-width="14" stroke-linecap="round"/>
  <g class="ly-x" data-sfx="pop"><circle cx="150" cy="270" r="56" fill="#ef4b5f"/><path d="M126 246 L174 294 M174 246 L126 294" stroke="#fff" stroke-width="14" stroke-linecap="round"/></g>
</svg>
```

## 応答時間の変化

セッションDBをメモリに置くと、ログインの応答時間は180ミリ秒から110ミリ秒に縮みます。

```yaml figure
type: bar
unit: ミリ秒
items:
  - label: 変更前
    value: 180
  - label: 変更後
    value: 110
    emphasis: true
```

この数値は、動画の出力を試すための架空の値です。

```yaml narration
- 毎回セッションDBを見に行って、遅くならないのでしょうか？
- セッションDBをメモリに置くと、待ち時間は{#fast}短くなります。
- '{#before}180ミリ秒かかっていたログインが、{#after}110ミリ秒で終わるようになりました。'
- text: たとえば、書類を倉庫まで取りに行くのをやめて、机の引き出しに置くようなものです。
  example: true
```

```html motion
<zk-options hold="1"></zk-options>
<style>
.br-bg{position:absolute;inset:0;background:linear-gradient(#1b1634,#3a1f4f)}
.br-watch{position:absolute;left:880px;top:40px;width:160px;height:180px;animation:br-pop .5s cubic-bezier(.2,.8,.3,1.6) var(--fast) both}
.br-bar{position:absolute;bottom:330px;width:220px;border-radius:24px 24px 0 0;transform-origin:50% 100%}
.br-val{position:absolute;width:320px;text-align:center;color:#fff;font:800 48px var(--zk-font)}
.br-lab{position:absolute;top:772px;width:320px;text-align:center;color:#c9d4f2;font:800 40px var(--zk-font)}
.br-floor{position:absolute;left:560px;top:748px;width:800px;height:14px;border-radius:7px;background:#5b4a86}
.br-bolt{position:absolute;left:1300px;top:420px;width:120px;height:170px;animation:br-pop .5s cubic-bezier(.2,.8,.3,1.6) calc(var(--after) + 1.2s) both,br-wob 1.6s ease-in-out calc(var(--after) + 1.7s) infinite}
@keyframes br-pop{from{transform:scale(0)}}
@keyframes br-wob{50%{rotate:8deg}}
</style>
<div class="br-bg"></div>
<svg class="br-watch" viewBox="0 0 160 180" data-sfx="pop"><rect x="66" y="0" width="28" height="22" rx="6" fill="#c9d4f2"/><circle cx="80" cy="104" r="76" fill="#f5f7ff"/><circle cx="80" cy="104" r="62" fill="#ffc94a"/><rect class="br-hand" x="74" y="54" width="12" height="54" rx="6" fill="#1c2b52"/><circle cx="80" cy="104" r="10" fill="#1c2b52"/></svg>
<div class="br-floor"></div>
<div class="br-bar" id="br-a" style="left:650px;background:#8a7bb8"></div>
<div class="br-bar" id="br-b" style="left:1050px;background:var(--zk-yellow)"></div>
<div class="br-val" id="br-va" style="left:600px"></div>
<div class="br-val" id="br-vb" style="left:1000px"></div>
<div class="br-lab" style="left:600px">変更前</div>
<div class="br-lab" style="left:1000px">変更後</div>
<svg class="br-bolt" viewBox="0 0 120 170" data-sfx="chime"><path d="M70 0 L10 100 L55 100 L40 170 L110 60 L65 60 Z" fill="#ffc94a"/><path d="M70 0 L10 100 L55 100 Z" fill="#ffe08a"/></svg>
<script>
const root = document.currentScript.closest('.zk-scene');
const sec = (n) => parseFloat(getComputedStyle(root).getPropertyValue('--' + n));
const back = (p) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
const clamp = (v) => Math.max(0, Math.min(1, v));
zk.cue('draw', sec('before'), { dur: 1 });
zk.cue('draw', sec('after'), { dur: 1 });
zk.scene((t, el) => {
  // 棒は値に比例して伸び、数字は伸びに合わせて数え上げる。
  for (const [id, at, value] of [['a', 'before', 180], ['b', 'after', 110]]) {
    const p = clamp((t - sec(at)) / 1);
    const h = 440 * (value / 180) * back(p);
    el.querySelector(`#br-${id}`).style.height = `${Math.max(0, h)}px`;
    const v = el.querySelector(`#br-v${id}`);
    v.textContent = p > 0 ? `${Math.round(value * Math.min(1, p))}ミリ秒` : '';
    v.style.top = `${750 - Math.max(0, h) - 80}px`;
  }
  // ストップウォッチの針は、速く回る。
  el.querySelector('.br-hand').setAttribute('transform', `rotate(${Math.max(0, t - sec('fast')) * 540} 80 104)`);
});
</script>
```

```yaml narration ending
- ボタンを押した一瞬に、裏では3つのことが起きていました。
- '{#p1}パスワードは、受付のゲートウェイを通って、認証サービスが照合します。'
- '{#p2}ログインした印は、30分で消える合言葉として、ブラウザが預かります。'
- '{#p3}画面は、APIという窓口を通してだけ、保存先にさわります。'
- 次にログインのボタンを押すときは、この裏側を思い浮かべてみてください。
```

```html motion ending
<zk-options transition="zoom" hold="1"></zk-options>
<style>
.ed-bg{position:absolute;inset:0;background:linear-gradient(#141c3a,#22305f)}
.ed-title{position:absolute;left:0;right:0;top:70px;text-align:center;color:#fff;font:800 64px var(--zk-font);animation:ed-pop .6s cubic-bezier(.2,.8,.3,1.4) .2s both}
.ed-card{position:absolute;left:330px;width:1260px;height:150px;border-radius:30px;display:flex;align-items:center;gap:36px;padding:0 44px;color:#1c2b52;font:800 42px var(--zk-font);animation:ed-in .6s cubic-bezier(.2,.8,.3,1.3) var(--at) both}
.ed-num{flex:none;width:86px;height:86px;border-radius:50%;background:#1c2b52;color:#fff;display:flex;align-items:center;justify-content:center;font-size:48px}
@keyframes ed-pop{from{transform:scale(.4);opacity:0}}
@keyframes ed-in{from{transform:translateX(160px);opacity:0}}
</style>
<div class="ed-bg"></div>
<div class="ed-title" data-sfx="chime">まとめ</div>
<div class="ed-card" data-sfx="pop" style="top:220px;background:var(--zk-cyan);--at:var(--p1)"><div class="ed-num">1</div>受付を通って、認証サービスが照合する</div>
<div class="ed-card" data-sfx="pop" style="top:400px;background:var(--zk-yellow);--at:var(--p2)"><div class="ed-num">2</div>印は、30分で消える合言葉として預かる</div>
<div class="ed-card" data-sfx="pop" style="top:580px;background:var(--zk-orange);--at:var(--p3)"><div class="ed-num">3</div>画面は、APIを通して保存先にさわる</div>
```
