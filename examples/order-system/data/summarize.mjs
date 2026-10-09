// CSV を集計して、資料の図に入れる数値を出力する。資料の数値は、この出力と一致させる。
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const csv = (name) => {
  const [head, ...rows] = fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};
const num = (v) => Number(v);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const groupBy = (rows, key) => rows.reduce((m, r) => ((m[r[key]] ??= []).push(r), m), {});

const out = {};
const monthly = csv('monthly.csv');
out.monthly = { x: monthly.map((r) => r.month), 注文作成: monthly.map((r) => num(r.order_create)), 注文照会: monthly.map((r) => num(r.order_read)) };
const [prev, last] = monthly.slice(-2);
out.monthlyChange = { 注文作成の前月比: round((num(last.order_create) / num(prev.order_create) - 1) * 100), 注文照会の前月比: round((num(last.order_read) / num(prev.order_read) - 1) * 100) };

const hourly = csv('hourly.csv');
const byDay = groupBy(hourly, 'weekday');
out.heatmap = { x: [...new Set(hourly.map((r) => `${r.hour}時`))], y: Object.keys(byDay), values: Object.values(byDay).map((rows) => rows.map((r) => num(r.requests_per_min))) };
const peak = hourly.reduce((a, b) => (num(b.requests_per_min) > num(a.requests_per_min) ? b : a));
const weekdayNight = hourly.filter((r) => r.hour === '21' && !['土', '日'].includes(r.weekday)).map((r) => num(r.requests_per_min));
out.heatmapPeak = { 曜日: peak.weekday, 時刻: `${peak.hour}時`, 値: num(peak.requests_per_min), 平日21時の平均: round(sum(weekdayNight) / weekdayNight.length, 0) };

const latency = groupBy(csv('latency.csv'), 'api');
const q = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};
out.latency = Object.fromEntries(Object.entries(latency).map(([api, rows]) => [api, rows.map((r) => num(r.ms)).sort((a, b) => a - b)]));
out.latencyStats = Object.fromEntries(Object.entries(out.latency).map(([api, v]) => [api, { 件数: v.length, 中央値: round(q(v, 0.5), 0), 第3四分位: round(q(v, 0.75), 0), 最大: v.at(-1), '500ミリ秒超': v.filter((x) => x > 500).length }]));

out.slo = Object.fromEntries(csv('slo.csv').map((r) => [r.api, round((num(r.within_500ms) / num(r.total)) * 100)]));

const funnel = csv('funnel.csv');
out.funnel = funnel.map((r) => [r.from, r.to, num(r.count)]);
const total = sum(funnel.filter((r) => r.from === '注文の要求').map((r) => num(r.count)));
const paid = num(funnel.find((r) => r.to === '決済に成功').count);
out.funnelStats = { 要求の合計: total, 決済に成功した割合: round((paid / total) * 100), 在庫不足の割合: round((12360 / total) * 100), カードの拒否の割合: round((11350 / total) * 100) };

const errors = csv('errors-5xx.csv');
const errorTotal = sum(errors.map((r) => num(r.count)));
out.errors = { 合計: errorTotal, 内訳: errors.map((r) => [r.cause, num(r.count), `${round((num(r.count) / errorTotal) * 100)}%`]) };
const requests = sum(csv('slo.csv').map((r) => num(r.total)));
out.errorRate = { 全要求: requests, '5xxの割合': `${round((errorTotal / requests) * 100, 3)}%`, 成功率: `${round((1 - errorTotal / requests) * 100, 2)}%` };

const cost = groupBy(csv('cost.csv'), 'group');
out.cost = Object.fromEntries(Object.entries(cost).map(([g, rows]) => [g, { 合計: round(sum(rows.map((r) => num(r.man_yen)))), 項目: rows.map((r) => [r.item, num(r.man_yen)]) }]));
out.costTotal = round(sum(csv('cost.csv').map((r) => num(r.man_yen))));

out.incident = csv('incident-0917.csv');
console.log(JSON.stringify(out, null, 1).replace(/\n\s+(?=[\d\]"-])/g, ' '));
