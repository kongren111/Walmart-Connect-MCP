#!/usr/bin/env node
// 生成自包含 HTML 分析报告
import { result, suggestBid, suggestPremium, TARGET_ROAS, round2, OUT_DIR } from "./analyze-real.mjs";
import fs from "node:fs";
import path from "node:path";

const R = result;
const T = TARGET_ROAS;
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => "$" + (n || 0).toFixed(2);
const pct = (n) => ((n || 0) * 100).toFixed(1) + "%";
const num = (n) => (n || 0).toFixed(2);

// ROAS 条形
function roasBar(roas, maxRoas) {
  const w = maxRoas > 0 ? Math.min(100, (roas / maxRoas) * 100) : 0;
  let color = "#c62828"; // <1 红
  if (roas >= T) color = "#2e7d32"; // 达标 绿
  else if (roas >= 1) color = "#f9a825"; // 1~目标 黄
  const label = roas > 0 ? roas.toFixed(2) : "—";
  return `<div class="bar"><span style="width:${w}%;background:${color}"></span><b>${label}</b></div>`;
}
function tagClass(tag) {
  return { up: "t-up", down: "t-down", hold: "t-hold", pause: "t-pause", watch: "t-watch", idle: "t-idle" }[tag] || "t-hold";
}
function tagText(tag) {
  return { up: "扩量", down: "降价", hold: "维持", pause: "暂停/否词", watch: "观察", idle: "待查" }[tag] || "维持";
}

// ---- 表头/表行工具 ----
function table(headers, rowsHtml) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rowsHtml.join("")}</tbody></table>`;
}

// ---------- KPI ----------
const kpi = [
  ["总广告花费", money(R.overall.adSpend)],
  ["总 GMV(成交额)", money(R.overall.attributedSales)],
  ["整体 ROAS", num(R.overall.roas) + "×"],
  ["ACoS", pct(R.overall.acos)],
  ["订单数", R.overall.orders.toFixed(1)],
  ["展现量", Math.round(R.overall.impressions).toLocaleString()],
  ["点击量", Math.round(R.overall.clicks).toLocaleString()],
  ["CTR", pct(R.overall.ctr)],
  ["CVR", pct(R.overall.cvr)],
  ["平均 CPC", money(R.overall.cpc)],
];

// ---------- 活动表 ----------
const campMax = Math.max(1, ...R.campaigns.map((c) => c.roas));
const campRows = R.campaigns.map((c) => `<tr>
  <td class="l">${esc(c.campaignName)}</td>
  <td>${esc(c.campaignType || "—")}</td>
  <td>${esc(c.biddingStrategy || "—")}</td>
  <td class="r">${money(c.adSpend)}</td>
  <td class="r">${money(c.attributedSales)}</td>
  <td>${roasBar(c.roas, campMax)}</td>
  <td class="r">${pct(c.acos)}</td>
  <td class="r">${c.orders.toFixed(1)}</td>
  <td class="r">${Math.round(c.impressions).toLocaleString()}</td>
  <td class="r">${Math.round(c.clicks).toLocaleString()}</td>
  <td class="r">${pct(c.ctr)}</td>
  <td class="r">${pct(c.cvr)}</td>
  <td class="r">${c.items}</td>
  <td class="r">${c.adGroups}</td>
</tr>`);

// ---------- 广告组表 ----------
const agMax = Math.max(1, ...R.adGroups.map((a) => a.roas));
const agRows = R.adGroups.map((a) => `<tr>
  <td class="l">${esc(a.campaignName)}</td>
  <td class="l">${esc(a.adGroupName || a.adGroupId)}</td>
  <td class="r">${money(a.adSpend)}</td>
  <td class="r">${money(a.attributedSales)}</td>
  <td>${roasBar(a.roas, agMax)}</td>
  <td class="r">${pct(a.acos)}</td>
  <td class="r">${a.orders.toFixed(1)}</td>
  <td class="r">${Math.round(a.impressions).toLocaleString()}</td>
  <td class="r">${pct(a.cvr)}</td>
</tr>`);

// ---------- 商品表 ----------
const itemMax = Math.max(1, ...R.items.map((i) => i.roas));
const itemRows = R.items.map((i) => {
  const h = i.health;
  const hl = h ? `${esc(h.inStock || "?")} / ${esc(h.buyBox || "?")} / ${esc(h.rating || "?")}` : "—";
  return `<tr>
    <td class="l">${esc(i.itemName || i.itemId)}</td>
    <td class="l dim">${esc(i.campaignName)}</td>
    <td class="r">${money(i.adSpend)}</td>
    <td class="r">${money(i.attributedSales)}</td>
    <td>${roasBar(i.roas, itemMax)}</td>
    <td class="r">${pct(i.acos)}</td>
    <td class="r">${i.orders.toFixed(1)}</td>
    <td class="r">${money(i.avgBid)}</td>
    <td class="r dim">${hl}</td>
  </tr>`;
});

// ---------- 关键词竞价建议 ----------
const kwRows = R.keywords.map((k) => {
  const s = suggestBid(k);
  return `<tr>
    <td class="l">${esc(k.biddedKeyword)}</td>
    <td>${esc(k.matchType)}</td>
    <td class="l dim">${esc(k.adGroupName || k.adGroupId)}</td>
    <td class="r">${money(k.avgBid)}</td>
    <td class="r">${money(k.adSpend)}</td>
    <td class="r">${money(k.attributedSales)}</td>
    <td>${roasBar(k.roas, campMax)}</td>
    <td class="r">${k.orders.toFixed(1)}</td>
    <td><span class="tag ${tagClass(s.tag)}">${s.action}</span></td>
    <td class="r">${money(s.newBid)}</td>
    <td class="l dim">${esc(s.note)}</td>
  </tr>`;
});

// ---------- 放置溢价建议 ----------
const plRows = R.placements.filter((p) => p.adSpend > 0).map((p) => {
  const s = suggestPremium(p.roas);
  return `<tr>
    <td class="l">${esc(p.campaignName)}</td>
    <td class="l">${esc(p.placement)}</td>
    <td class="r">${money(p.adSpend)}</td>
    <td class="r">${money(p.attributedSales)}</td>
    <td>${roasBar(p.roas, campMax)}</td>
    <td class="r">${p.orders.toFixed(1)}</td>
    <td><span class="tag ${tagClass(s.tag)}">${s.action}</span></td>
    <td class="l dim">${esc(s.note)}</td>
  </tr>`;
});

// ---------- 平台 ----------
const pfRows = R.platforms.filter((p) => p.adSpend > 0).map((p) => {
  const [cn, pl] = p.key.split("|||");
  return `<tr><td class="l">${esc(cn)}</td><td class="l">${esc(pl)}</td><td class="r">${money(p.adSpend)}</td><td class="r">${money(p.attributedSales)}</td><td>${roasBar(p.roas, campMax)}</td><td class="r">${p.orders.toFixed(1)}</td></tr>`;
});

// ---------- 维度 ----------
const dimRows = R.dims.map((d) => `<tr><td class="l">${esc(d.dimName)}</td><td class="l">${esc(d.dimValue)}</td><td class="r">${money(d.adSpend)}</td><td class="r">${money(d.attributedSales)}</td><td>${roasBar(d.roas, campMax)}</td><td class="r">${d.orders.toFixed(1)}</td></tr>`);

// ---------- 搜索词机会 ----------
const soRows = R.searchOpp.slice(0, 25).map((s) => `<tr><td class="l">${esc(s.term)}</td><td class="r">${Math.round(s.impressions).toLocaleString()}</td><td class="r">${pct(s.share / 100)}</td><td class="r">${pct(s.topShare / 100)}</td><td class="r">${s.rank.toFixed(1)}</td><td class="r">${money(s.adSpend)}</td><td>${roasBar(s.roas, campMax)}</td><td><span class="tag t-up">加价抢份额</span></td></tr>`);

// ---------- 建议汇总 ----------
const scaleUp = [], reduce = [];
for (const k of R.keywords) { const s = suggestBid(k); if (s.tag === "up") scaleUp.push({ name: k.biddedKeyword + " (" + k.matchType + ")", from: k.avgBid, to: s.newBid, note: s.note }); else if (s.tag === "down" || s.tag === "pause") reduce.push({ name: k.biddedKeyword + " (" + k.matchType + ")", from: k.avgBid, to: s.newBid, note: s.note, tag: s.tag }); }
for (const i of R.items) { const s = suggestBid(i); if (s.tag === "up") scaleUp.push({ name: "商品:" + (i.itemName || i.itemId).slice(0, 30), from: i.avgBid, to: s.newBid, note: s.note }); }
const plPrem = R.placements.filter((p) => p.adSpend > 0).map((p) => suggestPremium(p.roas)).filter((s) => s.tag !== "hold");
const recHtml = `
<div class="rec-block">
  <h3>① 扩量（高效单元提价 +15%）— ${scaleUp.length} 项</h3>
  ${scaleUp.length ? `<ul>${scaleUp.slice(0, 40).map((x) => `<li><b>${esc(x.name)}</b>：竞价 $${x.from.toFixed(2)} → <b>$${x.to.toFixed(2)}</b><span class="dim"> · ${esc(x.note)}</span></li>`).join("")}</ul>` : "<p class='dim'>无（当前无 ROAS≥目标×1.3 且花费≥$20 的单元）</p>"}
</div>
<div class="rec-block">
  <h3>② 止损（低效/零单单元降价或暂停）— ${reduce.length} 项</h3>
  ${reduce.length ? `<ul>${reduce.slice(0, 40).map((x) => `<li><b>${esc(x.name)}</b>：<span class="tag ${tagClass(x.tag)}">${tagText(x.tag)}</span> <span class="dim">· ${esc(x.note)}</span></li>`).join("")}</ul>` : "<p class='dim'>无</p>"}
</div>
<div class="rec-block">
  <h3>③ 放置溢价调整 — ${plPrem.length} 项</h3>
  ${plPrem.length ? `<ul>${R.placements.filter((p) => p.adSpend > 0).map((p) => { const s = suggestPremium(p.roas); return s.tag === "hold" ? "" : `<li><b>${esc(p.campaignName)} / ${esc(p.placement)}</b>：<span class="tag ${tagClass(s.tag)}">${s.action}</span><span class="dim"> · ${esc(s.note)}</span></li>`; }).join("")}</ul>` : "<p class='dim'>无（各位置 ROAS 均接近整体水平）</p>"}
</div>
<div class="rec-block">
  <h3>④ 预算再分配（活动内）</h3>
  ${R.realloc.length ? R.realloc.map((r) => `<p><b>${esc(r.campaign)}</b>：将低效广告组 <span class="dim">[${r.lo.map(esc).join(", ")}]</span> 的可释放预算 <b>${money(r.released)}</b> 转移到高效广告组 <span class="dim">[${r.hi.map(esc).join(", ")}]</span></p>`).join("") : "<p class='dim'>无（各活动内未同时出现高/低效广告组）</p>"}
</div>
<div class="rec-block">
  <h3>⑤ 搜索词份额机会（高 ROAS 低展现份额→加价）</h3>
  ${R.searchOpp.length ? `<ul>${R.searchOpp.slice(0, 20).map((s) => `<li><b>${esc(s.term)}</b>：ROAS ${s.roas.toFixed(2)}，展现份额 ${pct(s.share / 100)} <span class="dim">· 提高竞价以获取更多 Top of Search 份额</span></li>`).join("")}</ul>` : "<p class='dim'>无</p>"}
</div>`;

// ---------- 趋势图 (SVG) ----------
function trendSvg() {
  const d = R.dailySeries; if (d.length < 2) return "<p class='dim'>数据点不足</p>";
  const W = 720, H = 220, pad = 36;
  const maxS = Math.max(1, ...d.map((x) => Math.max(x.adSpend, x.attributedSales)));
  const x = (i) => pad + (i * (W - pad * 2)) / (d.length - 1);
  const y = (v) => H - pad - (v / maxS) * (H - pad * 2);
  const line = (key, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${d.map((p, i) => `${x(i)},${y(p[key])}`).join(" ")}"/>`;
  const dots = (key, color) => d.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[key])}" r="2.5" fill="${color}"/>`).join("");
  const labels = d.map((p, i) => (i % Math.ceil(d.length / 8) === 0 ? `<text x="${x(i)}" y="${H - 12}" font-size="9" fill="#666" text-anchor="middle">${p.date.slice(5)}</text>` : "")).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${line("adSpend", "#1565c0")}${dots("adSpend", "#1565c0")}${line("attributedSales", "#2e7d32")}${dots("attributedSales", "#2e7d32")}<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#ccc"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="#ccc"/>${labels}<text x="8" y="16" font-size="10" fill="#1565c0">■ 花费</text><text x="60" y="16" font-size="10" fill="#2e7d32">■ GMV</text></svg>`;
}

// ---------- 组装 HTML ----------
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>沃尔玛广告分析报告</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:0;background:#f5f6f8;color:#1f2933;font-size:13px}
.wrap{max-width:1180px;margin:0 auto;padding:24px}
header{background:#1a237e;color:#fff;border-radius:12px;padding:22px 26px;margin-bottom:20px}
header h1{margin:0 0 6px;font-size:22px}
header .meta{opacity:.85;font-size:12px;line-height:1.7}
h2{font-size:17px;margin:28px 0 10px;padding-left:10px;border-left:4px solid #1a237e}
h3{font-size:14px;margin:14px 0 6px}
.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:6px}
.card{background:#fff;border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card .k{font-size:11px;color:#607d8b;margin-bottom:4px}
.card .v{font-size:18px;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:8px}
th,td{padding:7px 9px;text-align:left;border-bottom:1px solid #eef1f4;font-size:12px;vertical-align:middle}
th{background:#eceff4;color:#37474f;font-weight:600;position:sticky;top:0}
td.r,th.r{text-align:right}
td.l{text-align:left}
td.dim, .dim{color:#78909c;font-size:11px}
tr:hover td{background:#fafbfc}
.bar{position:relative;height:16px;background:#f0f2f5;border-radius:4px;min-width:90px}
.bar span{position:absolute;left:0;top:0;height:100%;border-radius:4px}
.bar b{position:absolute;right:6px;top:0;font-size:11px;line-height:16px;color:#37474f;font-weight:600}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;white-space:nowrap}
.t-up{background:#2e7d32}.t-down{background:#ef6c00}.t-hold{background:#546e7a}.t-pause{background:#c62828}.t-watch{background:#8d6e63}.t-idle{background:#757575}
.rec-block{background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.rec-block ul{margin:6px 0;padding-left:18px}.rec-block li{margin:4px 0}
.note{background:#fffde7;border:1px solid #fff59d;border-radius:8px;padding:10px 14px;font-size:12px;color:#5d4037;line-height:1.7;margin:10px 0}
.foot{color:#90a4ae;font-size:11px;margin-top:30px;line-height:1.7}
.scroll{max-height:none;overflow:auto}
</style></head>
<body><div class="wrap">
<header>
  <h1>沃尔玛广告本地分析报告</h1>
  <div class="meta">生成时间：${esc(R.generated)} ｜ 目标 ROAS：${T}× ｜ 数据文件：${R.fileCount} 个真实后台报告<br>
  数据窗口：中文自定义报告「Aug 30, 2026 – Sep 28, 2026」（14 天归因口径）</div>
</header>

<div class="cards">${kpi.map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>

<div class="note"><b>方法说明：</b>${esc(R.methodology)}<br>
注意：本窗口转化较稀疏（整体 ${R.overall.orders.toFixed(0)} 笔订单），活动/广告组/关键词 ROAS 为按花费占比回灌的估算值；出价建议基于回灌 ROAS 与阈值，落地前请结合实时后台复核。</div>

<h2>一、活动（Campaign）表现与建议</h2>
${table(["活动", "类型", "竞价策略", "花费", "GMV", "ROAS", "ACoS", "订单", "展现", "点击", "CTR", "CVR", "商品", "广告组"], campRows)}

<h2>二、广告组（Ad Group）表现</h2>
${table(["活动", "广告组", "花费", "GMV", "ROAS", "ACoS", "订单", "展现", "CVR"], agRows)}

<h2>三、商品（Item）表现</h2>
${table(["商品", "所属活动", "花费", "GMV", "ROAS", "ACoS", "订单", "当前竞价", "库存/购物车/评分"], itemRows)}

<h2>四、关键词竞价建议</h2>
${table(["出价词", "匹配", "广告组", "当前竞价", "花费", "GMV", "ROAS", "订单", "建议", "建议竞价", "理由"], kwRows)}

<h2>五、放置（Placement）溢价建议</h2>
${table(["活动", "位置", "花费", "GMV", "ROAS", "订单", "建议", "理由"], plRows)}

<h2>六、平台（Platform）表现</h2>
${table(["活动", "平台", "花费", "GMV", "ROAS", "订单"], pfRows)}

<h2>七、维度分析（匹配方式 / 品牌 / 竞价策略 / 活动类型）</h2>
${table(["维度", "值", "花费", "GMV", "ROAS", "订单"], dimRows)}

<h2>八、搜索词份额机会</h2>
${table(["搜索词", "展现", "展现份额", "搜索顶部份额", "排名", "花费", "ROAS", "建议"], soRows)}

<h2>九、每日趋势（花费 vs GMV）</h2>
<div class="card" style="box-shadow:0 1px 3px rgba(0,0,0,.08)">${trendSvg()}</div>

<h2>十、优化建议汇总（可行动清单）</h2>
${recHtml}

<div class="foot">
数据来源：${R.fileCount} 个沃尔玛广告后台真实报告（关键词绩效 / 放置绩效 / 商品绩效 / 商品关键词绩效 / 搜索展现次数 / 归因采购 / item-health / 自定义报告×8）。<br>
销售额口径：中文自定义报告 14 天归因 GMV；花费/展现/点击/竞价口径：英文标准导出。<br>
本分析为本地离线计算，不上传任何数据。阈值（目标 ROAS=${T}）可在重新运行时调整。
</div>
</div></body></html>`;

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(OUT_DIR, `report-${ts}.html`);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(outFile, html);
console.log("HTML report written:", outFile, "(" + html.length + " bytes)");
console.log("OUT_FILE=" + outFile);
