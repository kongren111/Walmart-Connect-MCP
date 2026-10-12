// parser.js — Walmart 广告报告摄取：CSV 解析 + 列名归一化 + 报告类型识别
// 浏览器(ES module)与 Node(测试) 通用。Excel 解析依赖浏览器全局 XLSX(SheetJS)。

export const COLUMN_ALIASES = {
  date: ['date', 'day', 'report date', 'start date', 'end date', 'time', 'period'],
  campaignId: ['campaign id', 'campaignid', 'campaign id (informational)'],
  campaignName: ['campaign name', 'campaign', 'campaign name (informational)'],
  adGroupId: ['ad group id', 'adgroupid', 'ad group id (informational)'],
  adGroupName: ['ad group', 'ad group name', 'adgroup', 'ad group name (informational)'],
  keyword: ['keyword', 'keyword text', 'keyword (text)', 'search term', 'search query', 'query', 'customer search term'],
  itemId: ['item id', 'itemid', 'item id (informational)', 'product id', 'wpid'],
  itemName: ['item name', 'product name', 'title', 'product title', 'item name (informational)'],
  placement: ['placement', 'placement name', 'placement type'],
  platform: ['platform', 'device', 'device type'],
  impressions: ['impressions'],
  clicks: ['clicks'],
  spend: ['spend', 'spend ($)', 'spend (usd)', 'cost', 'total spend', 'cost ($)'],
  orders: ['orders', 'total orders', 'units', 'units sold', 'conversions'],
  revenue: ['revenue', 'sales', 'total revenue', 'item revenue', 'pixel revenue', 'roas revenue'],
  roas: ['roas'],
  acos: ['acos', 'a cos'],
  ctr: ['ctr'],
  cpc: ['cpc', 'avg cpc', 'cost per click'],
};

function normKey(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ALIAS_LOOKUP = (() => {
  const m = {};
  for (const [canon, list] of Object.entries(COLUMN_ALIASES)) {
    for (const a of list) m[normKey(a)] = canon;
  }
  return m;
})();

export function buildColumnMap(headers) {
  const map = {};
  const unmatched = [];
  for (const h of headers) {
    const canon = ALIAS_LOOKUP[normKey(h)];
    if (canon) map[canon] = h;
    else if (String(h ?? '').trim() !== '') unmatched.push(h);
  }
  return { map, unmatched };
}

// 报告类型识别（按列优先级）
export function detectReportType(map) {
  const has = (k) => !!map[k];
  if (has('keyword') && (has('campaignName') || has('campaignId') || has('adGroupName'))) return 'keyword';
  if (has('itemId') || has('itemName')) return 'adItem';
  if (has('placement')) return 'placement';
  if (has('platform')) return 'platform';
  if (has('adGroupName') || has('adGroupId')) return 'adGroup';
  if (has('campaignName') || has('campaignId')) return 'campaign';
  if (has('date') && (has('impressions') || has('clicks') || has('spend'))) return 'performance';
  return 'unknown';
}

export function num(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// CSV 解析（支持引号、转义引号、字段内换行）
export function parseCSV(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQ = false;
  text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  const out = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const r = nonEmpty[i];
    if (r.every((c) => c.trim() === '')) continue;
    const obj = {};
    header.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    out.push(obj);
  }
  return out;
}

// 把原始行归一化为标准记录，并标记报告类型
export function normalizeDataset(rawRows, filename = '') {
  if (!rawRows || rawRows.length === 0) return { type: 'empty', rows: [], unmatched: [], map: {}, filename };
  const headers = Object.keys(rawRows[0]);
  const { map, unmatched } = buildColumnMap(headers);
  const type = detectReportType(map);
  const rows = rawRows.map((r) => {
    const g = (k) => (map[k] ? r[map[k]] : (k in r ? r[k] : undefined));
    const impressions = num(g('impressions'));
    const clicks = num(g('clicks'));
    const spend = num(g('spend'));
    const orders = num(g('orders'));
    const revenue = num(g('revenue'));
    const roas = g('roas') !== undefined && g('roas') !== '' ? num(g('roas')) : (spend > 0 ? revenue / spend : 0);
    const acos = g('acos') !== undefined && g('acos') !== '' ? num(g('acos')) : (revenue > 0 ? spend / revenue : 0);
    return {
      date: (g('date') ?? '').toString().trim(),
      campaignId: (g('campaignId') ?? '').toString().trim(),
      campaignName: (g('campaignName') ?? '').toString().trim(),
      adGroupId: (g('adGroupId') ?? '').toString().trim(),
      adGroupName: (g('adGroupName') ?? '').toString().trim(),
      keyword: (g('keyword') ?? '').toString().trim(),
      itemId: (g('itemId') ?? '').toString().trim(),
      itemName: (g('itemName') ?? '').toString().trim(),
      placement: (g('placement') ?? '').toString().trim(),
      platform: (g('platform') ?? '').toString().trim(),
      impressions, clicks, spend, orders, revenue, roas, acos,
    };
  });
  return { type, rows, unmatched, map, filename };
}

// 浏览器端 Excel 解析（合并所有工作表）
export async function parseExcelFile(file) {
  const XLSX = (typeof window !== 'undefined' && window.XLSX) || globalThis.XLSX;
  if (!XLSX) throw new Error('SheetJS (XLSX) 未加载');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    out.push(...json);
  }
  return out;
}
