// test.mjs — 端到端校验：解析示例报告 → 归一化 → 分析，断言无崩溃且产出合理
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCSV, normalizeDataset } from './public/parser.js';
import { runAnalysis, generateSkill } from './public/analysis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleDir = join(__dirname, 'public', 'sample');
const files = ['campaign.csv', 'adgroup.csv', 'keyword.csv', 'performance.csv', 'placement.csv', 'platform.csv'];

const datasets = [];
for (const f of files) {
  const text = readFileSync(join(sampleDir, f), 'utf8');
  const ds = normalizeDataset(parseCSV(text), f);
  console.log(`  ${f.padEnd(16)} → type=${ds.type.padEnd(11)} rows=${String(ds.rows.length).padStart(3)} unmatched=[${ds.unmatched.join(',')}]`);
  datasets.push(ds);
}

const result = runAnalysis(datasets);
const o = result.overview;
console.log('\n=== 整体概览 ===');
console.log(`  花费=$${o.spend.toFixed(0)} 销售额=$${o.revenue.toFixed(0)} ROAS=${o.roas.toFixed(2)} ACoS=${(o.acos * 100).toFixed(1)}%`);
console.log(`  曝光=${o.impressions} 点击=${o.clicks} 订单=${o.orders} CTR=${(o.ctr * 100).toFixed(2)}%`);

console.log('\n=== 建议汇总 ===');
console.log('  ', JSON.stringify(result.suggestions));

console.log('\n=== 0 表现关键词（关掉重开）===');
result.keywords.zeroPerf.forEach((k) => console.log(`   - ${k.keyword} (活动:${k.campaign})`));
console.log('\n=== 否词候选 ===');
result.keywords.negatives.forEach((k) => console.log(`   - ${k.keyword} 花费$${k.spend} 点击${k.clicks} 0订单`));
console.log('\n=== Placement 溢价 ===');
result.placement.forEach((p) => console.log(`   - ${p.placement}: ROAS ${p.roas.toFixed(2)} 溢价 ${(p.delta * 100).toFixed(0)}%`));
console.log('\n=== 趋势 ===');
console.log(`   天数=${result.trend.daily.length} WoW=${result.trend.wow ? '有' : '无'} MoM=${result.trend.mom ? '有' : '无'}`);

// 断言
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exit(1); } };
assert(o.spend > 0 && o.revenue > 0, '整体指标应为正');
assert(o.roas > 0, 'ROAS 应>0');
assert(result.campaigns.length === 3, '应识别 3 个活动');
assert(result.keywords.zeroPerf.length >= 1, '应识别至少 1 个 0 表现关键词');
assert(result.keywords.negatives.length >= 1, '应识别至少 1 个否词候选');
assert(result.trend.daily.length === 30, '趋势应为 30 天');
assert(result.placement.length === 2, '应识别 2 个 placement');
const skill = generateSkill(result, result.config);
assert(skill.includes('# Walmart 广告优化 Skill'), 'Skill 应包含标题');

console.log('\n✅ 全部断言通过');
