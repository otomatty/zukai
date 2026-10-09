// サンプルの運用データを作る。乱数の種を固定しているので、何度実行しても同じ CSV になる。
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
let seed = 20260930;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const write = (name, header, rows) => fs.writeFileSync(path.join(dir, name), [header, ...rows].map((r) => r.join(',')).join('\n') + '\n');

// 月ごとの要求数（万件）。
write('monthly.csv', ['month', 'order_create', 'order_read'], [
  ['4月', 31.8, 118], ['5月', 33.5, 124], ['6月', 34.1, 127], ['7月', 39.6, 151], ['8月', 38.2, 149], ['9月', 41.2, 158],
]);

// 曜日と時間帯ごとの、1分あたりの平均要求数。昼と夜に山があり、週末は夜が高い。
const days = ['月', '火', '水', '木', '金', '土', '日'];
const shape = { 0: 0.18, 3: 0.08, 6: 0.25, 9: 0.62, 12: 0.9, 15: 0.66, 18: 0.84, 21: 1.0 };
const hourly = [];
for (const [i, d] of days.entries()) {
  for (const [h, w] of Object.entries(shape)) {
    const weekend = i >= 5 ? (h >= 18 || h == 0 ? 1.35 : 1.1) : 1;
    hourly.push([d, h, Math.round(52 * w * weekend * (0.94 + rand() * 0.12))]);
  }
}
write('hourly.csv', ['weekday', 'hour', 'requests_per_min'], hourly);

// API ごとの応答時間（ミリ秒）。各 API から40件ずつ抜き出した値。裾が長い分布にする。
const apis = { 注文作成: [300, 0.38], 注文照会: [44, 0.3], 在庫照会: [58, 0.33], 注文取消: [205, 0.3] };
const latency = [];
for (const [api, [median, spread]] of Object.entries(apis)) {
  for (let i = 0; i < 40; i++) {
    const normal = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    latency.push([api, Math.round(median * Math.exp(spread * normal))]);
  }
}
write('latency.csv', ['api', 'ms'], latency);

// 全要求のうち、500ミリ秒以内に応答した件数。
write('slo.csv', ['api', 'total', 'within_500ms'], [
  ['注文作成', 412000, 386456], ['注文照会', 1580000, 1573680], ['在庫照会', 2946000, 2922432], ['注文取消', 23500, 22889],
]);

// 注文の要求が、どの段階でどれだけ減ったか（件）。
write('funnel.csv', ['from', 'to', 'count'], [
  ['注文の要求', '受付', 391400], ['注文の要求', '在庫不足', 12360], ['注文の要求', '入力の誤り', 8240],
  ['受付', '決済に成功', 377700], ['受付', 'カードの拒否', 11350], ['受付', '決済の時間切れ', 2350],
]);

// 5xx エラーの原因（件）。
write('errors-5xx.csv', ['cause', 'count'], [
  ['DB接続の枯渇', 1860], ['決済サービスの遅延', 640], ['デプロイ中の切断', 210], ['その他', 190],
]);

// 費用（万円）。
write('cost.csv', ['group', 'item', 'man_yen'], [
  ['実行環境', 'Fargate', 18.4], ['実行環境', 'NAT Gateway', 5.2], ['実行環境', 'Lambda', 0.6],
  ['データ', 'Aurora', 21.5], ['データ', 'S3', 1.3], ['データ', 'SQS', 0.2],
  ['配信と監視', 'CloudFront', 6.8], ['配信と監視', 'CloudWatch', 4.9], ['配信と監視', 'ALB', 3.1],
]);

// 9月17日の障害の記録。
write('incident-0917.csv', ['time', 'event', 'detail'], [
  ['20:00', 'セール開始', '要求数が通常の3倍'],
  ['20:06', 'タスクが6つに増加', 'DB接続が120本に'],
  ['20:09', '5xxエラー発生', '接続の上限に到達'],
  ['20:31', '接続上限を変更', '1タスク12本に'],
  ['20:38', '復旧', 'エラー率が平常に'],
]);
