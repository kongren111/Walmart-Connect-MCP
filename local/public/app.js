// app.js — 仪表盘编排：文件摄取 → 归一化 → 分析 → 渲染
import { parseCSV, normalizeDataset, parseExcelFile } from './parser.js';
import { runAnalysis, DEFAULT_CONFIG, generateSkill, fmt } from './analysis.js';
import { lineChart, barChart } from './charts.js';

const state = {
  datasets: [],
  config: { ...DEFAULT_CONFIG },
  result: null,
};

const $ = (id) => document.getElementById(id);

function roasPill(v) {
  const t = state.config.targetRoas;
  if (v >= t) return `<span class="pill good">${v.toFixed(2)}</span>`;
  if (v > 0 && v < state.config.lowRoas) return `<span class="pill bad">${v.toFixed(2)}</span>`;
  return `<span class="pill warn">${v.toFixed(2)}</span>`;
}
const money = (v) => '$' + fmt(v);
const pct = (v) => (v * 100).toFixed(1) + '%';

function table(headers, rows, opts = {}) {
  let h = '<table><thead><tr>' + headers.map((x) => `<th class="${x.num ? 'num' : ''}">${x.t}</th>`).join('') + '</tr></thead><tbody>';
  if (!rows.length) { h += `<tr><td colspan="${headers.length}" class="empty">无数据</td></tr>`; }
  for (const r of rows) {
    h += '<tr>' + headers.map((x) => {
      const val = x.f ? x.f(r) : r[x.k];
      return `<td class="${x.num ? 'num' : ''}">${val ?? ''}</td>`;
    }).join('') + '</tr>';
  }
  h += '</tbody></table>';
  return h;
}

async function ingestFile(file) {
  const name = file.name.toLowerCase();
  let raw;
  if (name.endsWith('.csv')) {
    raw = parseCSV(await file.text());
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    raw = await parseExcelFile(file);
  } else {
    throw new Error('不支持的文件类型：' + file.name);
  }
  return normalizeDataset(raw, file.name);
}

async function loadFiles(fileList) {
  for (const file of fileList) {
    try {
      const ds = await ingestFile(file);
      if (ds.type === 'empty') { setStatus(`⚠️ ${file.name} 无有效数据，已跳过`); continue; }
      state.datasets.push(ds);
    } catch (e) {
      setStatus(`⚠️ ${file.name} 解析失败：${e.message}`);
    }
  }
  render();
}

function setStatus(html) { $('status').innerHTML = html; }

function render() {
  if (!state.datasets.length) {
    $('kpis').innerHTML = '';
    ['trendSpend','trendRoas','campaignBar','adGroupBar','kwTable','placementTable','platformTable','budgetTable','summary','kwZero','trendNote','trendTag','warn'].forEach((id)=>{ const e=$(id); if(e) e.innerHTML=''; });
    setStatus('尚未加载数据。可点击「加载示例数据」体验，或拖入你的报告文件。');
    return;
  }
  const result = runAnalysis(state.datasets, state.config);
  state.result = result;
  renderStatus(result);
  renderKPIs(result.overview);
  renderTrend(result.trend);
  renderCampaigns(result.campaigns);
  renderAdGroups(result.adGroups);
  renderKeywords(result.keywords);
  renderPlacement(result.placement);
  renderPlatform(result.platform);
  renderBudget(result.budget);
  renderSummary(result);
}

function renderStatus(result) {
  const meta = result.datasetsMeta.map((m) => `${m.filename} <span class="pill neu">${m.type}</span> <span class="pill neu">${m.rows}行</span>`).join(' &nbsp; ');
  setStatus(`已加载 <b>${state.datasets.length}</b> 个文件：` + meta);
  const unmatchedAll = result.datasetsMeta.filter((m) => m.unmatched && m.unmatched.length);
  if (unmatchedAll.length) {
    const detail = unmatchedAll.map((m) => `${m.filename}: ${m.unmatched.join(', ')}`).join('；');
    $('warn').innerHTML = `<div class="warnbox">⚠️ 以下列未被识别（不影响已识别字段；如指标异常请确认列名）：${detail}</div>`;
  } else $('warn').innerHTML = '';
}

function renderKPIs(o) {
  const cards = [
    { l: '总花费', v: money(o.spend) },
    { l: '销售额', v: money(o.revenue) },
    { l: 'ROAS', v: o.roas.toFixed(2), s: `ACoS ${pct(o.acos)}`, cls: o.roas >= state.config.targetRoas ? 'good' : 'bad' },
    { l: '订单', v: fmt(o.orders) },
    { l: '点击', v: fmt(o.clicks), s: `CTR ${pct(o.ctr)}`, cls: '' },
    { l: '曝光', v: fmt(o.impressions) },
    { l: 'CPC', v: money(o.cpc), s: `CVR ${pct(o.cvr)}`, cls: '' },
  ];
  $('kpis').innerHTML = cards.map((c) => `<div class="kpi"><div class="v">${c.v}</div><div class="l">${c.l}</div>${c.s ? `<div class="s ${c.cls || ''}">${c.s}</div>` : ''}</div>`).join('');
}

function renderTrend(trend) {
  if (!trend.daily.length) {
    $('trendTag').textContent = '无日期数据';
    $('trendSpend').innerHTML = '<div class="empty">报告未包含日期列，无法绘制趋势</div>';
    $('trendRoas').innerHTML = '';
    $('trendNote').textContent = '';
    return;
  }
  $('trendTag').textContent = `${trend.daily.length} 天`;
  const labels = trend.daily.map((d) => d.date.slice(5));
  const spendSeries = { label: '花费', color: '#0071dc', points: trend.daily.map((d) => ({ y: d.spend })) };
  const revSeries = { label: '销售额', color: '#16a34a', points: trend.daily.map((d) => ({ y: d.revenue })) };
  lineChart($('trendSpend'), labels, [spendSeries, revSeries], { height: 220 });
  lineChart($('trendRoas'), labels, [{ label: 'ROAS', color: '#d97706', points: trend.daily.map((d) => ({ y: d.roas })) }], { height: 220 });
  const notes = [];
  if (trend.wow) notes.push(`环比(近7天 vs 前7天)：ROAS ${trend.wow.roasChange >= 0 ? '+' : ''}${(trend.wow.roasChange * 100).toFixed(1)}%，花费 ${(trend.wow.spendChange * 100).toFixed(1)}%`);
  if (trend.mom) notes.push(`同比(近28天 vs 前28天)：ROAS ${trend.mom.roasChange >= 0 ? '+' : ''}${(trend.mom.roasChange * 100).toFixed(1)}%，花费 ${(trend.mom.spendChange * 100).toFixed(1)}%`);
  $('trendNote').textContent = notes.join('　|　') || '数据不足 14 天，暂无法计算环比/同比。';
}

function renderCampaigns(campaigns) {
  const top = campaigns.slice(0, 10);
  barChart($('campaignBar'), top.map((c) => ({ label: c.campaignName || c.key, value: c.spend, color: '#0071dc' })), { height: 240, showValue: false });
  $('campaignBar').insertAdjacentHTML('beforeend', table(
    [{ t: '活动', k: 'campaignName' }, { t: '花费', k: 'spend', num: true, f: (r) => money(r.spend) },
     { t: '销售额', k: 'revenue', num: true, f: (r) => money(r.revenue) }, { t: 'ROAS', k: 'roas', num: true, f: (r) => roasPill(r.roas) },
     { t: '订单', k: 'orders', num: true, f: (r) => fmt(r.orders) }, { t: 'ACoS', k: 'acos', num: true, f: (r) => pct(r.acos) }],
    top
  ));
}

function renderAdGroups(adGroups) {
  const top = adGroups.slice(0, 10);
  barChart($('adGroupBar'), top.map((c) => ({ label: c.adGroupName || c.key, value: c.spend, color: '#0ea5e9' })), { height: 240, showValue: false });
  $('adGroupBar').insertAdjacentHTML('beforeend', table(
    [{ t: '广告组', k: 'adGroupName' }, { t: '活动', k: 'campaignName' },
     { t: '花费', k: 'spend', num: true, f: (r) => money(r.spend) }, { t: 'ROAS', k: 'roas', num: true, f: (r) => roasPill(r.roas) },
     { t: '订单', k: 'orders', num: true, f: (r) => fmt(r.orders) }],
    top
  ));
}

function renderKeywords(kw) {
  const z = kw.zeroPerf.length;
  $('kwZero').innerHTML = z
    ? `<span class="pill bad">${z} 个关键词 0 曝光</span> 建议暂停后重新开启（更换匹配类型 / 提高竞价 / 检查审核状态）。`
    : `<span class="pill good">无 0 曝光关键词</span>`;
  const headers = [
    { t: '关键词', k: 'keyword' }, { t: '活动', k: 'campaign' },
    { t: '花费', k: 'spend', num: true, f: (r) => money(r.spend) },
    { t: '曝光', k: 'impressions', num: true, f: (r) => fmt(r.impressions) },
    { t: '点击', k: 'clicks', num: true, f: (r) => fmt(r.clicks) },
    { t: '订单', k: 'orders', num: true, f: (r) => fmt(r.orders) },
    { t: 'ROAS', k: 'roas', num: true, f: (r) => roasPill(r.roas) },
    { t: '建议', k: 'act', f: (r) => r._act || '' },
  ];
  const rows = [
    ...kw.bidLower.map((r) => ({ ...r, _act: `<span class="pill bad">降价${' '}${(state.config.bidLowerPct * 100).toFixed(0)}%</span>${r.note ? ' ' + r.note : ''}` })),
    ...kw.negatives.map((r) => ({ ...r, _act: `<span class="pill warn">否词候选</span>` })),
    ...kw.bidRaise.map((r) => ({ ...r, _act: `<span class="pill good">提价 ${(state.config.bidRaisePct * 100).toFixed(0)}%</span>` })),
    ...kw.newKeywords.map((r) => ({ ...r, _act: `<span class="pill neu">新增词</span>` })),
  ];
  $('kwTable').innerHTML = table(headers, rows.slice(0, 60));
}

function renderPlacement(pl) {
  if (!pl.length) { $('placementTable').innerHTML = '<div class="empty">未加载 Placement 报告</div>'; return; }
  $('placementTable').innerHTML = table(
    [{ t: 'Placement', k: 'placement' }, { t: '花费', k: 'spend', num: true, f: (r) => money(r.spend) },
     { t: 'ROAS', k: 'roas', num: true, f: (r) => roasPill(r.roas) },
     { t: '建议溢价', k: 'delta', num: true, f: (r) => r.delta > 0 ? `<span class="pill good">+${(r.delta * 100).toFixed(0)}%</span>` : r.delta < 0 ? `<span class="pill bad">${(r.delta * 100).toFixed(0)}%</span>` : `<span class="pill neu">0%</span>` }],
    pl
  );
}

function renderPlatform(pl) {
  if (!pl.length) { $('platformTable').innerHTML = '<div class="empty">未加载 Platform 报告</div>'; return; }
  $('platformTable').innerHTML = table(
    [{ t: 'Platform', k: 'platform' }, { t: '花费', k: 'spend', num: true, f: (r) => money(r.spend) },
     { t: 'ROAS', k: 'roas', num: true, f: (r) => roasPill(r.roas) },
     { t: '建议溢价', k: 'delta', num: true, f: (r) => r.delta > 0 ? `<span class="pill good">+${(r.delta * 100).toFixed(0)}%</span>` : r.delta < 0 ? `<span class="pill bad">${(r.delta * 100).toFixed(0)}%</span>` : `<span class="pill neu">0%</span>` }],
    pl
  );
}

function renderBudget(b) {
  const rows = b.budget.map((c) => ({
    ...c,
    _act: c.action === 'raise' ? `<span class="pill good">提预算 +${(c.pct * 100).toFixed(0)}%</span>`
      : c.action === 'lower' ? `<span class="pill bad">降预算 -${(c.pct * 100).toFixed(0)}%</span>`
      : `<span class="pill neu">维持</span>`,
  }));
  let h = table(
    [{ t: '活动', k: 'campaignName' }, { t: '花费', k: 'spend', num: true, f: (r) => money(r.spend) },
     { t: 'ROAS', k: 'roas', num: true, f: (r) => roasPill(r.roas) },
     { t: '预算建议', k: '_act' }, { t: '说明', k: 'note' }],
    rows
  );
  if (b.autoBid.length) {
    h += '<div style="margin-top:12px;font-size:13px;color:var(--muted)"><b>自动竞价建议</b></div>';
    h += '<table style="margin-top:6px"><thead><tr><th>活动</th><th class="num">ROAS</th><th>建议</th></tr></thead><tbody>' +
      b.autoBid.map((a) => `<tr><td>${a.campaignName}</td><td class="num">${roasPill(a.roas)}</td><td>${a.note}</td></tr>`).join('') + '</tbody></table>';
  }
  if (b.reallocatable > 0) h += `<div class="status" style="margin-top:8px">💰 可从低效活动释放约 <b>${money(b.reallocatable)}</b> 预算，重新分配给高效活动扩量。</div>`;
  $('budgetTable').innerHTML = h;
}

function renderSummary(r) {
  const s = r.suggestions;
  const items = [
    ['需关掉重开的关键词(0曝光)', s.zeroPerf, 'bad'],
    ['否定词候选', s.negatives, 'warn'],
    ['建议提价关键词', s.bidRaise, 'good'],
    ['建议降价/暂停关键词', s.bidLower, 'bad'],
    ['新增词候选', s.newKeywords, 'neu'],
    ['Placement 溢价调整', s.placement, 'neu'],
    ['Platform 溢价调整', s.platform, 'neu'],
    ['活动提预算', s.budgetRaise, 'good'],
    ['活动降预算', s.budgetLower, 'bad'],
  ];
  $('summary').innerHTML = items.map(([label, n, cls]) => `<span class="pill ${cls}" style="margin:0 8px 8px 0">${label}: ${n}</span>`).join('') ||
    '暂无建议';
}

// ---- 事件绑定 ----
$('drop').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => loadFiles(e.target.files));
const drop = $('drop');
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hover'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('hover'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files); });

function syncConfig() {
  state.config.targetRoas = parseFloat($('targetRoas').value) || 3;
  state.config.highRoas = parseFloat($('highRoas').value) || 5;
  state.config.lowRoas = parseFloat($('lowRoas').value) || 2;
  if (state.datasets.length) render();
}
['targetRoas', 'highRoas', 'lowRoas'].forEach((id) => $(id).addEventListener('input', syncConfig));

$('loadSample').addEventListener('click', async () => {
  setStatus('正在加载示例数据…');
  const files = ['campaign.csv', 'adgroup.csv', 'keyword.csv', 'performance.csv', 'placement.csv', 'platform.csv'];
  try {
    const res = await Promise.all(files.map((f) => fetch('./sample/' + f).then((r) => r.text())));
    state.datasets = [];
    res.forEach((text, i) => { const ds = normalizeDataset(parseCSV(text), files[i]); if (ds.type !== 'empty') state.datasets.push(ds); });
    render();
  } catch (e) {
    setStatus('示例数据加载失败：' + e.message);
  }
});

$('exportSkill').addEventListener('click', () => {
  if (!state.result) { alert('请先加载数据'); return; }
  const md = generateSkill(state.result, state.config);
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'walmart-optimization-skill.md';
  a.click();
});
