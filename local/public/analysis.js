// analysis.js — 本地 Walmart 广告分析引擎（纯函数，无 DOM 依赖，浏览器/Node 通用）

export const DEFAULT_CONFIG = {
  targetRoas: 3,        // 目标 ROAS
  highRoas: 5,          // 高效阈值
  lowRoas: 2,           // 低效阈值
  negSpendThreshold: 5, // 否词候选：花费 >= 此值
  negClicksThreshold: 10, // 否词候选：点击 >= 此值且无订单
  bidRaisePct: 0.15,    // 高效词提价幅度
  bidLowerPct: 0.20,    // 低效词降价幅度
  placementStep: 0.10,  // 溢价步进
  budgetRaisePct: 0.20, // 高效活动提预算
  budgetLowerPct: 0.20, // 低效活动降预算
};

function safe(v) { return v && isFinite(v) ? v : 0; }

// 汇总一组记录的指标，并计算衍生指标
export function aggregate(rows) {
  const t = { impressions: 0, clicks: 0, spend: 0, orders: 0, revenue: 0 };
  for (const r of rows) {
    t.impressions += safe(r.impressions);
    t.clicks += safe(r.clicks);
    t.spend += safe(r.spend);
    t.orders += safe(r.orders);
    t.revenue += safe(r.revenue);
  }
  t.roas = t.spend > 0 ? t.revenue / t.spend : 0;
  t.acos = t.revenue > 0 ? t.spend / t.revenue : 0;
  t.ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
  t.cpc = t.clicks > 0 ? t.spend / t.clicks : 0;
  t.cvr = t.clicks > 0 ? t.orders / t.clicks : 0;
  return t;
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// 建立 活动名 ↔ 活动ID 映射，解决不同报告列名不一致导致的重复分组
function buildCampaignIndex(allRows) {
  const idByName = new Map();
  const nameById = new Map();
  for (const r of allRows) {
    if (r.campaignId && r.campaignName) {
      idByName.set(r.campaignName, r.campaignId);
      nameById.set(r.campaignId, r.campaignName);
    }
  }
  return { idByName, nameById };
}
function campaignKey(r, idx) {
  if (r.campaignId) return r.campaignId;
  if (r.campaignName && idx.idByName.has(r.campaignName)) return idx.idByName.get(r.campaignName);
  return r.campaignName || '未命名活动';
}
function campaignName(r, idx) {
  return r.campaignName || (r.campaignId && idx.nameById.get(r.campaignId)) || r.campaignId || '未命名活动';
}

// 活动效率排名
function rankCampaigns(allRows) {
  const idx = buildCampaignIndex(allRows);
  const m = groupBy(allRows.filter((r) => r.campaignName || r.campaignId), (r) => campaignKey(r, idx));
  const list = [];
  for (const [k, rows] of m) {
    const a = aggregate(rows);
    const sample = rows[0];
    list.push({
      key: k,
      campaignId: k.startsWith('C') ? k : sample.campaignId,
      campaignName: campaignName(sample, idx),
      ...a,
    });
  }
  list.sort((x, y) => y.spend - x.spend);
  return list;
}

// 广告组效率排名
function rankAdGroups(allRows) {
  const idx = buildCampaignIndex(allRows);
  const m = groupBy(
    allRows.filter((r) => (r.adGroupName || r.adGroupId) && (r.campaignName || r.campaignId)),
    (r) => `${campaignKey(r, idx)} || ${r.adGroupId || r.adGroupName}`
  );
  const list = [];
  for (const [k, rows] of m) {
    const a = aggregate(rows);
    const sample = rows[0];
    list.push({
      key: k,
      campaignName: campaignName(sample, idx),
      adGroupId: sample.adGroupId,
      adGroupName: sample.adGroupName || k.split(' || ')[1],
      ...a,
    });
  }
  list.sort((x, y) => y.spend - x.spend);
  return list;
}

// 关键词级分析（0表现/否词/竞价/新增词）
function analyzeKeywords(keywordRows, cfg, overall) {
  const m = groupBy(
    keywordRows,
    (r) => `${r.campaignId || r.campaignName || 'camp'} || ${r.keyword || '(空)'}`
  );
  const zeroPerf = [];
  const negatives = [];
  const bidRaise = [];
  const bidLower = [];
  const newKeywords = [];
  const bidKeywords = new Set(); // 已作为关键词投放的词

  for (const [k, rows] of m) {
    const a = aggregate(rows);
    const kw = rows[0].keyword;
    if (!kw) continue;
    bidKeywords.add(kw.toLowerCase());
    const rec = { key: k, keyword: kw, campaign: rows[0].campaignName || rows[0].campaignId, ...a };

    // 0 表现：整个周期无曝光 -> 建议关掉重开
    if (a.impressions === 0) {
      zeroPerf.push(rec);
      continue;
    }
    // 否词候选：有花费有点击但 0 订单
    if (a.orders === 0 && a.spend >= cfg.negSpendThreshold && a.clicks >= cfg.negClicksThreshold) {
      negatives.push(rec);
    }
    // 竞价建议
    if (a.spend > 0) {
      if (a.roas >= cfg.targetRoas * 1.5) {
        bidRaise.push({ ...rec, suggestedMultiplier: 1 + cfg.bidRaisePct });
      } else if (a.roas > 0 && a.roas < cfg.targetRoas * 0.6) {
        bidLower.push({ ...rec, suggestedMultiplier: 1 - cfg.bidLowerPct });
      } else if (a.roas === 0) {
        bidLower.push({ ...rec, suggestedMultiplier: 1 - cfg.bidLowerPct, note: '零转化，建议降价或暂停' });
      }
    }
    // 新增词候选：有订单且高效（搜索词报告中表现好、但可能尚未作为关键词投放）
    if (a.orders > 0 && a.roas >= cfg.highRoas) {
      newKeywords.push(rec);
    }
  }
  return { zeroPerf, negatives, bidRaise, bidLower, newKeywords };
}

// Placement 溢价建议
function placementMultipliers(rows, cfg, overallRoas) {
  const m = groupBy(rows, (r) => r.placement);
  const list = [];
  for (const [k, rs] of m) {
    if (!k) continue;
    const a = aggregate(rs);
    let sugg = 0;
    if (a.roas > overallRoas * 1.2) sugg = cfg.placementStep;
    else if (a.roas > 0 && a.roas < overallRoas * 0.7) sugg = -cfg.placementStep;
    list.push({ placement: k, ...a, suggestedMultiplier: 1 + sugg, delta: sugg });
  }
  list.sort((x, y) => y.roas - x.roas);
  return list;
}

// Platform 溢价建议
function platformMultipliers(rows, cfg, overallRoas) {
  const m = groupBy(rows, (r) => r.platform);
  const list = [];
  for (const [k, rs] of m) {
    if (!k) continue;
    const a = aggregate(rs);
    let sugg = 0;
    if (a.roas > overallRoas * 1.2) sugg = cfg.placementStep;
    else if (a.roas > 0 && a.roas < overallRoas * 0.7) sugg = -cfg.placementStep;
    list.push({ platform: k, ...a, suggestedMultiplier: 1 + sugg, delta: sugg });
  }
  list.sort((x, y) => y.roas - x.roas);
  return list;
}

// 趋势分析（按日）+ 环比/同比
function trendAnalysis(datedRows) {
  const m = groupBy(datedRows, (r) => r.date);
  const daily = [];
  for (const [d, rs] of m) {
    if (!d) continue;
    daily.push({ date: d, ...aggregate(rs) });
  }
  daily.sort((a, b) => (a.date < b.date ? -1 : 1));
  let wow = null;
  let mom = null;
  if (daily.length >= 14) {
    const last7 = daily.slice(-7);
    const prev7 = daily.slice(-14, -7);
    wow = {
      last7: aggregate(last7), prev7: aggregate(prev7),
      roasChange: pct(aggregate(last7).roas, aggregate(prev7).roas),
      spendChange: pct(aggregate(last7).spend, aggregate(prev7).spend),
    };
  }
  if (daily.length >= 28) {
    const last28 = daily.slice(-28);
    const prev28 = daily.slice(-56, -28);
    mom = {
      last28: aggregate(last28), prev28: aggregate(prev28),
      roasChange: pct(aggregate(last28).roas, aggregate(prev28).roas),
      spendChange: pct(aggregate(last28).spend, aggregate(prev28).spend),
    };
  }
  return { daily, wow, mom };
}

function pct(a, b) { return b > 0 ? (a - b) / b : 0; }

// 活动预算 / 自动竞价建议
function budgetAndAutoBid(campaigns, cfg) {
  const budget = [];
  let reallocatable = 0;
  for (const c of campaigns) {
    if (c.roas >= cfg.targetRoas) {
      budget.push({ ...c, action: 'raise', pct: cfg.budgetRaisePct, note: 'ROAS 达标，建议提高日预算扩量' });
    } else if (c.roas > 0 && c.roas < cfg.lowRoas) {
      budget.push({ ...c, action: 'lower', pct: cfg.budgetLowerPct, note: 'ROAS 偏低，建议缩减日预算并优化' });
      reallocatable += c.spend * cfg.budgetLowerPct;
    } else {
      budget.push({ ...c, action: 'hold', pct: 0, note: 'ROAS 接近目标，维持观察' });
    }
  }
  const autoBid = campaigns.map((c) => {
    let note;
    if (c.roas >= cfg.highRoas) note = '放宽自动竞价上限以抢量';
    else if (c.roas > 0 && c.roas < cfg.lowRoas) note = '降低自动竞价上限控成本';
    else note = '维持自动竞价并持续观察';
    return { campaignName: c.campaignName, roas: c.roas, spend: c.spend, note };
  });
  return { budget, autoBid, reallocatable };
}

// 从分析结果总结生成“优化 Skill”（Markdown）
export function generateSkill(result, cfg) {
  const lines = [];
  lines.push('# Walmart 广告优化 Skill（由本地数据自动总结）');
  lines.push('');
  lines.push(`> 自动生成于分析运行；目标 ROAS = ${cfg.targetRoas}，高效阈值 = ${cfg.highRoas}，低效阈值 = ${cfg.lowRoas}`);
  lines.push('');
  lines.push('## 整体表现');
  const o = result.overview;
  lines.push(`- 总花费 $${fmt(o.spend)}，销售额 $${fmt(o.revenue)}，ROAS ${o.roas.toFixed(2)}，ACoS ${(o.acos * 100).toFixed(1)}%`);
  lines.push(`- 曝光 ${fmt(o.impressions)}，点击 ${fmt(o.clicks)}，订单 ${fmt(o.orders)}，CTR ${(o.ctr * 100).toFixed(2)}%，CVR ${(o.cvr * 100).toFixed(2)}%`);
  lines.push('');
  lines.push('## 可复用优化规则（Playbook）');
  lines.push(`1. 当关键词 ROAS ≥ 目标×1.5 且已有花费 → 提价 ${cfg.bidRaisePct * 100}%（抢量）`);
  lines.push(`2. 当关键词 ROAS < 目标×0.6（或零转化）→ 降价 ${cfg.bidLowerPct * 100}% 或暂停`);
  lines.push(`3. 搜索词花费 ≥ $${cfg.negSpendThreshold} 且点击 ≥ ${cfg.negClicksThreshold} 但 0 订单 → 加为否定词(精准/短语)`);
  lines.push(`4. 整周期 0 曝光关键词 → 暂停后重新开启（换匹配类型/提竞价）`);
  lines.push(`5. 搜索词有订单且 ROAS ≥ ${cfg.highRoas} → 加为精准关键词投放`);
  lines.push(`6. Placement / Platform 的 ROAS > 整体×1.2 → 溢价 +${(cfg.placementStep * 100).toFixed(0)}%；< 整体×0.7 → 溢价 -${(cfg.placementStep * 100).toFixed(0)}%`);
  lines.push(`7. 活动 ROAS ≥ 目标 → 日预算 +${(cfg.budgetRaisePct * 100).toFixed(0)}% 扩量；< 低效阈值 → 日预算 -${(cfg.budgetLowerPct * 100).toFixed(0)}%`);
  lines.push('');
  lines.push('## 本次具体行动清单');
  if (result.keywords.zeroPerf.length) {
    lines.push(`### 需关掉重开的关键词（${result.keywords.zeroPerf.length} 个，0 曝光）`);
    result.keywords.zeroPerf.slice(0, 30).forEach((k) => lines.push(`- [暂停重开] ${k.keyword}（活动：${k.campaign}）`));
  }
  if (result.keywords.negatives.length) {
    lines.push(`### 否定词候选（${result.keywords.negatives.length} 个）`);
    result.keywords.negatives.slice(0, 30).forEach((k) => lines.push(`- [否词] ${k.keyword}（花费 $${fmt(k.spend)}，点击 ${fmt(k.clicks)}，0 订单）`));
  }
  if (result.keywords.bidRaise.length) {
    lines.push(`### 提价关键词（${result.keywords.bidRaise.length} 个）`);
    result.keywords.bidRaise.slice(0, 30).forEach((k) => lines.push(`- [提价 +${(cfg.bidRaisePct * 100).toFixed(0)}%] ${k.keyword}（ROAS ${k.roas.toFixed(2)}）`));
  }
  if (result.keywords.bidLower.length) {
    lines.push(`### 降价/暂停关键词（${result.keywords.bidLower.length} 个）`);
    result.keywords.bidLower.slice(0, 30).forEach((k) => lines.push(`- [降价 -${(cfg.bidLowerPct * 100).toFixed(0)}%] ${k.keyword}（ROAS ${k.roas.toFixed(2)}）${k.note ? ' ' + k.note : ''}`));
  }
  if (result.keywords.newKeywords.length) {
    lines.push(`### 新增词候选（${result.keywords.newKeywords.length} 个）`);
    result.keywords.newKeywords.slice(0, 30).forEach((k) => lines.push(`- [加词] ${k.keyword}（订单 ${fmt(k.orders)}，ROAS ${k.roas.toFixed(2)}）`));
  }
  if (result.placement.length) {
    lines.push('### Placement 溢价建议');
    result.placement.forEach((p) => lines.push(`- ${p.placement}：ROAS ${p.roas.toFixed(2)} → 溢价 ${(p.delta * 100).toFixed(0)}%`));
  }
  if (result.platform.length) {
    lines.push('### Platform 溢价建议');
    result.platform.forEach((p) => lines.push(`- ${p.platform}：ROAS ${p.roas.toFixed(2)} → 溢价 ${(p.delta * 100).toFixed(0)}%`));
  }
  if (result.budget.autoBid.length) {
    lines.push('### 自动竞价建议');
    result.budget.autoBid.forEach((b) => lines.push(`- ${b.campaignName}（ROAS ${b.roas.toFixed(2)}）：${b.note}`));
  }
  lines.push('');
  lines.push('---');
  lines.push('复制以上规则即可作为可复用的广告优化 Skill；下次导入新报告后系统会自动重新生成。');
  return lines.join('\n');
}

export function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// 主入口：输入归一化后的数据集数组 [{type, rows, filename, unmatched}]
export function runAnalysis(datasets, cfg = DEFAULT_CONFIG) {
  const allRows = datasets.flatMap((d) => d.rows);
  const overview = aggregate(allRows);
  const overallRoas = overview.roas;

  const campaigns = rankCampaigns(allRows);
  const adGroups = rankAdGroups(allRows);
  const keywordRows = datasets.filter((d) => d.type === 'keyword').flatMap((d) => d.rows);
  const placementRows = datasets.filter((d) => d.type === 'placement').flatMap((d) => d.rows);
  const platformRows = datasets.filter((d) => d.type === 'platform').flatMap((d) => d.rows);
  const datedRows = allRows.filter((r) => r.date);

  const keywords = analyzeKeywords(keywordRows, cfg, overview);
  const placement = placementMultipliers(placementRows, cfg, overallRoas);
  const platform = platformMultipliers(platformRows, cfg, overallRoas);
  const trend = trendAnalysis(datedRows);
  const budget = budgetAndAutoBid(campaigns, cfg);

  // 合并所有可行动建议计数
  const suggestions = {
    zeroPerf: keywords.zeroPerf.length,
    negatives: keywords.negatives.length,
    bidRaise: keywords.bidRaise.length,
    bidLower: keywords.bidLower.length,
    newKeywords: keywords.newKeywords.length,
    placement: placement.filter((p) => p.delta !== 0).length,
    platform: platform.filter((p) => p.delta !== 0).length,
    budgetRaise: budget.budget.filter((b) => b.action === 'raise').length,
    budgetLower: budget.budget.filter((b) => b.action === 'lower').length,
  };

  return {
    overview,
    campaigns,
    adGroups,
    keywords,
    placement,
    platform,
    trend,
    budget,
    suggestions,
    config: cfg,
    datasetsMeta: datasets.map((d) => ({ filename: d.filename, type: d.type, rows: d.rows.length, unmatched: d.unmatched })),
  };
}
