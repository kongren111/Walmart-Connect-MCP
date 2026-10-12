#!/usr/bin/env node
// 真实沃尔玛广告报告分析引擎
// 数据建模：
//  - 中文「自定义报告」带真实成交(GMV)与维度（活动/平台/商品/页面类型/匹配方式/品牌/竞价策略/活动类型），但英文标准导出无 GMV。
//  - 英文标准导出（商品/关键词/放置绩效）带 活动/广告组/商品/关键词/位置 结构 + 花费/展现/点击/竞价，但几乎无成交。
//  - 因此：GMV 以中文自定义报告为准（活动级来自 (8)、平台级来自 (7)、商品级来自 (1)）；英文导出提供结构与竞价；
//    再把「活动级 GMV」按各广告组/关键词/位置的广告花费占比回灌，得到各层一致 ROAS 与竞价建议。
import fs from "node:fs";
import path from "node:path";

const DATA_DIR =
  process.env.DATA_DIR ||
  "C:/Users/Administrator/AppData/Roaming/ziniaobrowserdatas/ziniao browser/洛荟沃尔玛/";
const OUT_DIR = path.resolve("local/analysis_out");
const TARGET_ROAS = parseFloat(process.env.TARGET_ROAS || "3.0");
const MIN_SPEND = 5;

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let i = 0, row = [], field = "", inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQ = true; i++; }
      else if (c === ",") { row.push(field); field = ""; i++; }
      else if (c === "\r") { i++; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
      else { field += c; i++; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0].trim() === ""));
}
function toNum(v) {
  if (v == null) return 0;
  let s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "n/a") return 0;
  s = s.replace(/[^0-9.\-]/g, "");
  if (s === "" || s === "-") return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function toDate(v) {
  if (!v) return null;
  let s = String(v).trim().replace(/^"|"$/g, "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (m) { const y = 2000 + parseInt(m[3], 10); const mo = String(MONTHS[m[2]] || 0).padStart(2, "0"); return `${y}-${mo}-${String(parseInt(m[1], 10)).padStart(2, "0")}`; }
  return null;
}

const ALIASES = {
  date: ["date", "日期"], campaignName: ["campaign name", "campaign 名称"], campaignId: ["campaign id"],
  campaignType: ["campaign type", "广告活动类型名称"], biddingStrategy: ["current bidding strategy", "竞价策略"],
  targetROAS: ["current target roas"], adGroupName: ["ad group name"], adGroupId: ["ad group id"],
  itemId: ["item id", "商品 id", "id"], itemName: ["item name", "名称"], sku: ["sku id"],
  keyword: ["searched keyword"], biddedKeyword: ["bidded keyword"], matchType: ["match type", "匹配方式"],
  placement: ["placement", "页面类型"], platform: ["platform", "平台"], brand: ["品牌"],
  bid: ["bid"], impressions: ["impressions", "展示次数"], clicks: ["clicks", "点击 (clicks)", "点击"],
  ctr: ["ctr", "点击率 (ctr)", "点击率"], avgCPC: ["average cpc", "平均单次点击成本"],
  adSpend: ["ad spend", "广告支出"], orders: ["orders", "订单 - 14 天归因", "订单"],
  conversionRate: ["conversion rate", "转化率 - 14 天归因", "转化率"],
  attributedSales: ["total attributed sales", "广告总销售额-14天归因", "广告总销售额"],
  unitsSold: ["units sold"], roas: ["roas", "广告投资回报率 (roas) - 14 天"],
};
function buildColMap(header) {
  const norm = header.map((h) => String(h).trim().toLowerCase());
  const map = {};
  for (const [canon, aliases] of Object.entries(ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[canon] = idx;
  }
  return map;
}
function pick(row, map, canon, dflt = 0) { const i = map[canon]; return i == null ? dflt : row[i]; }
function classify(headerNorm) {
  const has = (s) => headerNorm.includes(s);
  if (has("search term impression share")) return "search";
  if (has("attribution type")) return "attribution";
  if (has("商品质量分数")) return "health";
  if (has("campaign 名称")) return "custom_campaign";
  if (has("placement")) return "placement";
  if (has("页面类型")) return "custom_page";
  if (has("searched keyword") || has("bidded keyword")) return "keyword";
  if (has("item name") && has("searched keyword") && has("item id")) return "itemkeyword";
  if (has("item id") && has("bid") && has("sku id")) return "item";
  if (has("商品 id")) return "custom_item";
  if (has("匹配方式") || has("品牌") || has("竞价策略") || has("广告活动类型名称")) return "custom_dim";
  return "unknown";
}

const WANT = [
  "自定义报告_09_30_2026 (1).csv", "自定义报告_09_30_2026.csv", "关键词绩效_2026_09_30_01_38_43.csv",
  "放置绩效_2026_09_30_01_38_51.csv", "商品关键词绩效_2026_09_30_01_39_01.csv", "商品绩效_2026_09_30_01_39_12.csv",
  "归因采购_2026_09_30_01_39_25.csv", "搜索展现次数_2026_09_30_01_39_39.csv", "item-health-report.csv",
  "自定义报告_09_30_2026 (8).csv", "自定义报告_09_30_2026 (7).csv", "自定义报告_09_30_2026 (5).csv",
  "自定义报告_09_30_2026 (4).csv", "自定义报告_09_30_2026 (3).csv", "自定义报告_09_30_2026 (2).csv",
];
const files = fs.readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith(".csv")).filter((f) => WANT.includes(f));

const records = []; // 英文结构化（item/keyword/placement/itemkeyword）
const healthMap = {}, searchTerms = [], attribution = [];
const customItemRows = [], customCampaignRows = [], customPageRows = [], customDimRows = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(DATA_DIR, f), "utf8");
  let rows = parseCSV(raw);
  if (rows.length && /时间段|period requested/i.test(rows[0][0] || "")) rows = rows.slice(1);
  if (rows.length < 2) continue;
  const header = rows[0];
  const headerNorm = header.map((h) => String(h).trim().toLowerCase());
  const kind = classify(headerNorm);
  const colMap = buildColMap(header);
  const mk = (row) => ({
    date: toDate(pick(row, colMap, "date", "")),
    campaignName: String(pick(row, colMap, "campaignName", "")).trim(),
    campaignId: String(pick(row, colMap, "campaignId", "")).trim(),
    campaignType: String(pick(row, colMap, "campaignType", "")).trim(),
    biddingStrategy: String(pick(row, colMap, "biddingStrategy", "")).trim(),
    targetROAS: toNum(pick(row, colMap, "targetROAS")) || null,
    adGroupName: String(pick(row, colMap, "adGroupName", "")).trim(),
    adGroupId: String(pick(row, colMap, "adGroupId", "")).trim(),
    itemId: String(pick(row, colMap, "itemId", "")).trim(),
    itemName: String(pick(row, colMap, "itemName", "")).trim(),
    sku: String(pick(row, colMap, "sku", "")).trim(),
    keyword: String(pick(row, colMap, "keyword", "")).trim(),
    biddedKeyword: String(pick(row, colMap, "biddedKeyword", "")).trim(),
    matchType: String(pick(row, colMap, "matchType", "")).trim(),
    placement: String(pick(row, colMap, "placement", "")).trim(),
    platform: String(pick(row, colMap, "platform", "")).trim(),
    brand: String(pick(row, colMap, "brand", "")).trim(),
    bid: toNum(pick(row, colMap, "bid")),
    impressions: toNum(pick(row, colMap, "impressions")),
    clicks: toNum(pick(row, colMap, "clicks")),
    ctr: toNum(pick(row, colMap, "ctr")),
    avgCPC: toNum(pick(row, colMap, "avgCPC")),
    adSpend: toNum(pick(row, colMap, "adSpend")),
    orders: toNum(pick(row, colMap, "orders")),
    conversionRate: toNum(pick(row, colMap, "conversionRate")),
    attributedSales: toNum(pick(row, colMap, "attributedSales")),
    unitsSold: toNum(pick(row, colMap, "unitsSold")),
  });
  if (kind === "health") {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; const id = String(pick(row, colMap, "itemId", "")).trim();
      if (!id) continue;
      healthMap[id] = {
        itemName: String(pick(row, colMap, "itemName", "")).trim(), status: String(pick(row, colMap, "status", "")).trim(),
        inStock: String(pick(row, colMap, "inStock", "")).trim(), buyBox: String(pick(row, colMap, "buyBox", "")).trim(),
        qualityScore: String(pick(row, colMap, "qualityScore", "")).trim(), priceComp: String(pick(row, colMap, "priceComp", "")).trim(),
        rating: String(pick(row, colMap, "rating", "")).trim(), contentQuality: String(pick(row, colMap, "contentQuality", "")).trim(),
      };
    }
    continue;
  }
  if (kind === "attribution") {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      attribution.push({ date: toDate(pick(row, colMap, "date", "")), campaign: String(pick(row, colMap, "campaignName", "")).trim(),
        adGroup: String(pick(row, colMap, "adGroupName", "")).trim(), attrType: String(pick(row, colMap, "attributionType", "")).trim(),
        advItem: String(pick(row, colMap, "itemId", "")).trim(), purchItem: String(pick(row, colMap, "purchasedItemId", "")).trim(),
        purchName: String(pick(row, colMap, "purchasedItemName", "")).trim(), sales: toNum(pick(row, colMap, "sales")), orders: toNum(pick(row, colMap, "orders")) });
    }
    continue;
  }
  if (kind === "search") {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      searchTerms.push({ term: String(pick(row, colMap, "searchTerm", "")).trim(), campaign: String(pick(row, colMap, "campaignName", "")).trim(),
        impressions: toNum(pick(row, colMap, "impressions")), clicks: toNum(pick(row, colMap, "clicks")),
        adSpend: toNum(pick(row, colMap, "adSpend")), orders: toNum(pick(row, colMap, "orders")), sales: toNum(pick(row, colMap, "attributedSales")),
        share: toNum(pick(row, colMap, "impressionShare")), topShare: toNum(pick(row, colMap, "topShare")), rank: toNum(pick(row, colMap, "imprRank")) });
    }
    continue;
  }
  if (kind === "custom_campaign") {
    for (let r = 1; r < rows.length; r++) { const rec = mk(rows[r]); rec.kind = "custom_campaign"; customCampaignRows.push(rec); }
    continue;
  }
  if (kind === "custom_dim") {
    for (let r = 1; r < rows.length; r++) {
      const rec = mk(rows[r]); rec.kind = "custom_dim"; rec.dimName = headerNorm[0]; rec.dimValue = String(rows[r][0]).trim();
      customDimRows.push(rec);
    }
    continue;
  }
  for (let r = 1; r < rows.length; r++) {
    const rec = mk(rows[r]); rec.kind = kind;
    if (kind === "custom_item") customItemRows.push(rec);
    else if (kind === "custom_page") customPageRows.push(rec);
    else records.push(rec);
  }
}

// ---------- 销售额来源（中文自定义报告）----------
// 活动级 GMV（来自 (8) Campaign 名称 + 日期）
const campSalesMap = {};
for (const r of customCampaignRows) {
  if (!r.campaignName) continue;
  if (!campSalesMap[r.campaignName]) campSalesMap[r.campaignName] = { adSpend: 0, attributedSales: 0, orders: 0, impressions: 0, clicks: 0 };
  const a = campSalesMap[r.campaignName];
  a.adSpend += r.adSpend; a.attributedSales += r.attributedSales; a.orders += r.orders; a.impressions += r.impressions; a.clicks += r.clicks;
}
// 平台级 GMV（来自 (7) Campaign 名称 + 平台）
const platformMap = {};
for (const r of customCampaignRows) {
  if (!r.campaignName || !r.platform) continue;
  const k = `${r.campaignName}|||${r.platform}`;
  if (!platformMap[k]) platformMap[k] = { adSpend: 0, attributedSales: 0, orders: 0, impressions: 0, clicks: 0 };
  const a = platformMap[k];
  a.adSpend += r.adSpend; a.attributedSales += r.attributedSales; a.orders += r.orders; a.impressions += r.impressions; a.clicks += r.clicks;
}
// 商品级 GMV（来自 (1) 商品 ID）
const itemSalesMap = {};
for (const r of customItemRows) {
  if (!r.itemId) continue;
  if (!itemSalesMap[r.itemId]) itemSalesMap[r.itemId] = { sales: 0, orders: 0 };
  itemSalesMap[r.itemId].sales += r.attributedSales; itemSalesMap[r.itemId].orders += r.orders;
}

// ---------- 英文结构化基数 ----------
const enItem = records.filter((r) => r.kind === "item");
const enKw = records.filter((r) => r.kind === "keyword");
const enPl = records.filter((r) => r.kind === "placement");

// 把活动级 GMV 按英文花费占比回灌到 广告组 / 关键词 / 放置
function allocBySpend(targetRows, groupKeyFn, campMap) {
  // 先算每组在活动内的花费
  const grpSpend = {};
  for (const r of targetRows) { const k = groupKeyFn(r); grpSpend[k] = (grpSpend[k] || 0) + r.adSpend; }
  const campGrpSpend = {};
  for (const r of targetRows) { const ck = r.campaignName; campGrpSpend[ck] = (campGrpSpend[ck] || 0) + r.adSpend; }
  for (const r of targetRows) {
    const cs = campMap[r.campaignName];
    const tot = campGrpSpend[r.campaignName];
    if (cs && cs.attributedSales > 0 && tot > 0) {
      const f = r.adSpend / tot;
      r.attributedSales = cs.attributedSales * f; r.orders = cs.orders * f;
    }
  }
}
allocBySpend(enItem, (r) => `${r.campaignName}|||${r.adGroupId || r.adGroupName}`, campSalesMap);
allocBySpend(enKw, (r) => `${r.campaignName}|||${r.adGroupId || r.adGroupName}`, campSalesMap);
allocBySpend(enPl, (r) => r.campaignName, campSalesMap);

// 商品级：用 (1) 商品 GMV 直接匹配（按英文 item 花费占比，若该商品在多活动投放）
const itemEngSpend = {};
for (const r of enItem) if (r.itemId) itemEngSpend[r.itemId] = (itemEngSpend[r.itemId] || 0) + r.adSpend;
for (const r of enItem) {
  const tot = itemEngSpend[r.itemId];
  if (r.itemId && tot > 0 && itemSalesMap[r.itemId] && itemSalesMap[r.itemId].sales > 0) {
    const f = r.adSpend / tot; r.attributedSales = itemSalesMap[r.itemId].sales * f; r.orders = itemSalesMap[r.itemId].orders * f;
  }
}

// ---------- 聚合工具 ----------
function emptyAgg() { return { impressions: 0, clicks: 0, adSpend: 0, orders: 0, attributedSales: 0, unitsSold: 0, bidSum: 0, bidN: 0, impr0: 0, rows: 0 }; }
function addTo(a, r) {
  a.impressions += r.impressions; a.clicks += r.clicks; a.adSpend += r.adSpend; a.orders += r.orders;
  a.attributedSales += r.attributedSales; a.unitsSold += r.unitsSold; a.rows += 1;
  if (r.bid > 0) { a.bidSum += r.bid; a.bidN += 1; }
  if (r.impressions === 0 && r.clicks === 0 && r.adSpend === 0) a.impr0 += 1;
}
function finalize(a) {
  return { ...a, roas: a.adSpend > 0 ? a.attributedSales / a.adSpend : 0, acos: a.attributedSales > 0 ? a.adSpend / a.attributedSales : 0,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0, cvr: a.clicks > 0 ? a.orders / a.clicks : 0,
    cpc: a.clicks > 0 ? a.adSpend / a.clicks : 0, avgBid: a.bidN > 0 ? a.bidSum / a.bidN : 0 };
}
function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, emptyAgg()); addTo(m.get(k), r); }
  return m;
}

// 总体（GMV 来自活动级自定义报告，花费来自英文）
const overallSpend = enItem.reduce((s, r) => s + r.adSpend, 0);
const overallSales = Object.values(campSalesMap).reduce((s, a) => s + a.attributedSales, 0);
const overall = finalize({ ...emptyAgg(), adSpend: overallSpend, attributedSales: overallSales,
  orders: Object.values(campSalesMap).reduce((s, a) => s + a.orders, 0),
  impressions: enItem.reduce((s, r) => s + r.impressions, 0), clicks: enItem.reduce((s, r) => s + r.clicks, 0) });
const overallRoas = overall.roas || 0;

// 活动（GMV 用自定义报告，结构用英文）
const campaigns = [...new Set([...Object.keys(campSalesMap), ...enItem.map((r) => r.campaignName)])].map((cn) => {
  const cs = campSalesMap[cn] || { adSpend: 0, attributedSales: 0, orders: 0, impressions: 0, clicks: 0 };
  const eng = enItem.filter((r) => r.campaignName === cn);
  const engSpend = eng.reduce((s, r) => s + r.adSpend, 0);
  const a = finalize({ ...emptyAgg(), adSpend: engSpend > 0 ? engSpend : cs.adSpend, attributedSales: cs.attributedSales,
    orders: cs.orders, impressions: eng.reduce((s, r) => s + r.impressions, 0) || cs.impressions, clicks: eng.reduce((s, r) => s + r.clicks, 0) || cs.clicks });
  const s = eng[0] || {};
  return { campaignName: cn, campaignId: s.campaignId, campaignType: s.campaignType, biddingStrategy: s.biddingStrategy, targetROAS: s.targetROAS,
    adGroups: new Set(eng.filter((r) => r.adGroupId).map((r) => r.adGroupId)).size, items: new Set(eng.filter((r) => r.itemId).map((r) => r.itemId)).size, ...a };
}).sort((a, b) => b.adSpend - a.adSpend);

const adGroups = [...group(enItem, (r) => `${r.campaignName}|||${r.adGroupId || r.adGroupName}`)].map(([k, a]) => {
  const f = finalize(a); const [cn, ag] = k.split("|||"); f.campaignName = cn; f.adGroupId = ag;
  const s = enItem.find((r) => r.campaignName === cn && (r.adGroupId || r.adGroupName) === ag); f.adGroupName = s.adGroupName; f.campaignType = s.campaignType;
  return f;
}).sort((a, b) => b.adSpend - a.adSpend);

const items = [...group(enItem, (r) => r.itemId || r.itemName)].map(([k, a]) => {
  const f = finalize(a); f.itemId = k; const s = enItem.find((r) => (r.itemId || r.itemName) === k);
  f.itemName = s.itemName; f.sku = s.sku; f.campaignName = s.campaignName; f.health = healthMap[k] || null;
  return f;
}).sort((a, b) => b.adSpend - a.adSpend);

const keywords = [...group(enKw, (r) => `${r.adGroupId || r.adGroupName}|||${r.biddedKeyword}|||${r.matchType}`)].map(([k, a]) => {
  const f = finalize(a); const [ag, bk, mt] = k.split("|||"); f.adGroupId = ag; f.biddedKeyword = bk; f.matchType = mt;
  const s = enKw.find((r) => `${r.adGroupId || r.adGroupName}|||${r.biddedKeyword}|||${r.matchType}` === k);
  f.campaignName = s.campaignName; f.adGroupName = s.adGroupName; f.searchedSample = s.keyword;
  return f;
}).sort((a, b) => b.adSpend - a.adSpend);

const placements = [...group(enPl, (r) => `${r.campaignName}|||${r.placement}`)].map(([k, a]) => {
  const f = finalize(a); const [cn, pl] = k.split("|||"); f.campaignName = cn; f.placement = pl;
  return f;
}).sort((a, b) => b.adSpend - a.adSpend);

// 平台明细（来自中文自定义报告 Campaign 名称 + 平台）
const platformList = [...new Map(Object.entries(platformMap).map(([k, a]) => [k, { key: k, ...finalize(a) }])).values()].sort((a, b) => b.adSpend - a.adSpend);

const searchAgg = [...group(searchTerms, (r) => r.term)].map(([k, a]) => {
  const rows = searchTerms.filter((x) => x.term === k); const sum = (fn) => rows.reduce((s, x) => s + fn(x), 0);
  return { term: k, impressions: sum((x) => x.impressions), adSpend: sum((x) => x.adSpend), attributedSales: sum((x) => x.sales), orders: sum((x) => x.orders),
    roas: sum((x) => x.adSpend) > 0 ? sum((x) => x.sales) / sum((x) => x.adSpend) : 0,
    share: rows.reduce((s, x) => s + x.share, 0) / rows.length, topShare: rows.reduce((s, x) => s + x.topShare, 0) / rows.length,
    rank: rows.reduce((s, x) => s + x.rank, 0) / rows.length };
}).sort((a, b) => b.adSpend - a.adSpend);

const dailyMap = new Map();
for (const r of customItemRows) { if (!r.date) continue; if (!dailyMap.has(r.date)) dailyMap.set(r.date, emptyAgg()); addTo(dailyMap.get(r.date), r); }
const dailySeries = [...dailyMap.entries()].map(([d, a]) => ({ date: d, ...finalize(a) })).sort((x, y) => x.date.localeCompare(y.date));

// 维度明细（匹配方式/品牌/竞价策略/活动类型）
const dimMap = {};
for (const r of customDimRows) {
  const k = `${r.dimName}|||${r.dimValue}`;
  if (!dimMap[k]) dimMap[k] = { dimName: r.dimName, dimValue: r.dimValue, adSpend: 0, attributedSales: 0, orders: 0, impressions: 0, clicks: 0 };
  const a = dimMap[k]; a.adSpend += r.adSpend; a.attributedSales += r.attributedSales; a.orders += r.orders; a.impressions += r.impressions; a.clicks += r.clicks;
}
const dims = Object.values(dimMap).map((d) => ({ ...d, roas: d.adSpend > 0 ? d.attributedSales / d.adSpend : 0, acos: d.attributedSales > 0 ? d.adSpend / d.attributedSales : 0 }));

// ---------- 建议逻辑 ----------
function round2(n) { return Math.round(n * 100) / 100; }
function suggestBid(rec) {
  const { avgBid, roas, orders, adSpend, impressions, clicks } = rec;
  if (impressions === 0 && clicks === 0 && adSpend === 0) return { action: "重新检查", note: "窗口内无任何展现/点击，检查关键词资格、出价是否过低或暂停状态", newBid: avgBid, tag: "idle" };
  if (adSpend >= MIN_SPEND && orders === 0) return { action: "暂停 / 否词", note: `花费 $${adSpend.toFixed(2)} 但 0 订单，建议暂停或加入否定词`, newBid: avgBid, tag: "pause" };
  if (orders === 0) return { action: "观察", note: "有展现但无转化，样本不足，暂观察", newBid: avgBid, tag: "watch" };
  if (roas >= TARGET_ROAS * 1.3 && adSpend >= 20) return { action: "提价 +15%", note: `ROAS ${roas.toFixed(2)} 远高于目标，高效可加价扩量`, newBid: round2(avgBid * 1.15), tag: "up" };
  if (roas >= TARGET_ROAS) return { action: "维持", note: `ROAS ${roas.toFixed(2)} 达标，保持当前竞价`, newBid: avgBid, tag: "hold" };
  if (roas >= 1) return { action: "降价 -15%", note: `ROAS ${roas.toFixed(2)} 低于目标，降低竞价止损`, newBid: round2(avgBid * 0.85), tag: "down" };
  return { action: "暂停 / 否词", note: `ROAS ${roas.toFixed(2)} 极低且无利，建议暂停`, newBid: avgBid, tag: "pause" };
}
function suggestPremium(plRoas) {
  if (overallRoas > 0 && plRoas >= overallRoas * 1.2) return { action: "提高溢价 +10%", note: `该位置 ROAS ${plRoas.toFixed(2)} 高于整体 ${overallRoas.toFixed(2)}，可加溢价抢量`, delta: 10, tag: "up" };
  if (overallRoas > 0 && plRoas < overallRoas * 0.8) return { action: "降低/关闭溢价", note: `该位置 ROAS ${plRoas.toFixed(2)} 低于整体，建议下调或关闭该位置溢价`, delta: -10, tag: "down" };
  return { action: "维持", note: "接近整体水平", delta: 0, tag: "hold" };
}
const realloc = [];
for (const c of campaigns) {
  const ags = adGroups.filter((a) => a.campaignName === c.campaignName);
  const hi = ags.filter((a) => a.roas >= TARGET_ROAS * 1.5 && a.adSpend >= 20);
  const lo = ags.filter((a) => a.roas < TARGET_ROAS && a.roas > 0 && a.adSpend >= 5);
  if (hi.length && lo.length) realloc.push({ campaign: c.campaignName, hi: hi.map((a) => a.adGroupName || a.adGroupId), lo: lo.map((a) => a.adGroupName || a.adGroupId), released: round2(lo.reduce((s, a) => s + a.adSpend, 0)) });
}
const searchOpp = searchAgg.filter((s) => s.roas >= TARGET_ROAS && s.share > 0 && s.share < 60 && s.adSpend >= 5).sort((a, b) => b.roas - a.roas);

const result = {
  generated: new Date().toLocaleString("zh-CN"), targetROAS: TARGET_ROAS, overall, overallRoas,
  campaigns, adGroups, items, keywords, placements, platforms: platformList, dims,
  searchAgg: searchAgg.slice(0, 60), searchOpp, realloc, dailySeries, fileCount: files.length,
  halo: attribution.length ? { total: attribution.reduce((s, a) => s + a.sales, 0), count: attribution.length } : null,
  methodology: "GMV(成交额)取自中文自定义报告：活动级来自「Campaign 名称+日期」报告、平台级来自「Campaign 名称+平台」报告、商品级来自「商品 ID」报告；英文标准导出（商品/关键词/放置绩效）提供活动/广告组/商品/关键词/位置结构与竞价。活动级 GMV 按英文广告花费占比回灌到广告组/关键词/位置，得到各层一致 ROAS。",
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "real-analysis." + Date.now() + ".json"), JSON.stringify(result, null, 2));
export { result, suggestBid, suggestPremium, TARGET_ROAS, round2, OUT_DIR };
