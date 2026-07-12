/* ===================================================================
   ASC.analysis — statistical analysis: distribution, group-by
   breakdowns, Top/Bottom N, outliers, duplicates, data quality.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.analysis = (function(){
  const { s, findHeader, rowKeyFor, remarkStatus, getValuationValue } = ASC.store;
  const { escapeHtml, formatCurrency, formatNumber, mean, median, mode, stddev, variance, quartiles } = ASC.utils;

  const GROUPABLE_PATTERNS = [
    {key:'broker', label:'Broker', re:/broker/i},
    {key:'grade', label:'Grade', re:/grade/i},
    {key:'category', label:'Category', re:/categ/i},
    {key:'garden', label:'Garden', re:/garden/i},
    {key:'elevation', label:'Elevation', re:/elevat/i},
    {key:'sale', label:'Sale No', re:/sale.?no/i},
    {key:'warehouse', label:'Warehouse', re:/warehouse/i},
    {key:'region', label:'Region', re:/region/i}
  ];

  let currentGroup = null;
  let currentTopN = 10;
  let currentTopMode = 'top';

  function availableGroups(){
    return GROUPABLE_PATTERNS.map(g=>({...g, col: findHeader(g.re)})).filter(g=>g.col);
  }

  function lotValuations(){
    return s.RAW.map(row=>({row, key: rowKeyFor(row), val: getValuationValue(rowKeyFor(row))}))
      .filter(x=>x.val!==null && !isNaN(x.val));
  }

  let lastDatasetKey = null;

  function ensureToolbar(){
    const groups = availableGroups();
    const sel = document.getElementById('analysisGroupSelect');
    if(sel && s.datasetKey !== lastDatasetKey){
      sel.innerHTML = groups.map(g=>`<option value="${g.key}">By ${g.label}</option>`).join('');
      currentGroup = groups[0] ? groups[0].key : null;
      lastDatasetKey = s.datasetKey;
    }
    if(sel && sel.dataset.bound!=='1'){
      sel.dataset.bound = '1';
      sel.addEventListener('change', ()=>{ currentGroup = sel.value; renderGroupBreakdown(); });
    }
    const topSel = document.getElementById('analysisTopN');
    if(topSel && topSel.dataset.built!=='1'){
      topSel.dataset.built='1';
      topSel.addEventListener('change', ()=>{ currentTopN = Number(topSel.value); renderTopBottom(); });
    }
    const modeToggle = document.getElementById('analysisTopMode');
    if(modeToggle && modeToggle.dataset.built!=='1'){
      modeToggle.dataset.built='1';
      modeToggle.querySelectorAll('button').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          modeToggle.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          currentTopMode = btn.dataset.mode;
          renderTopBottom();
        });
      });
    }
  }

  function render(){
    const empty = document.getElementById('analysisEmpty');
    const content = document.getElementById('analysisContent');
    if(!ASC.store.hasDataset()){
      if(empty) empty.style.display = 'block';
      if(content) content.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    if(content) content.style.display = 'block';

    ensureToolbar();
    renderOverview();
    renderGroupBreakdown();
    renderDistribution();
    renderTopBottom();
    renderDataQuality();
  }

  function renderOverview(){
    const wrap = document.getElementById('analysisOverview');
    if(!wrap) return;
    const vals = lotValuations().map(x=>x.val);
    const q = quartiles(vals);
    const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : NaN;
    const tiles = [
      ['Mean', formatCurrency(mean(vals),{decimals:2})],
      ['Median', formatCurrency(median(vals),{decimals:2})],
      ['Mode', mode(vals)!==null ? formatCurrency(Number(mode(vals)),{decimals:2}) : '—'],
      ['Std. Deviation', isNaN(stddev(vals))?'—':formatCurrency(stddev(vals),{decimals:2})],
      ['Variance', isNaN(variance(vals))?'—':formatNumber(variance(vals),2)],
      ['Q1 (25th pct.)', formatCurrency(q.q1,{decimals:2})],
      ['Q3 (75th pct.)', formatCurrency(q.q3,{decimals:2})],
      ['Price Spread', isNaN(spread)?'—':formatCurrency(spread,{decimals:2})]
    ];
    wrap.innerHTML = tiles.map(([lbl,num])=>`<div class="kpi-tile"><div class="kpi-num">${num}</div><div class="kpi-lbl">${lbl}</div></div>`).join('');
  }

  function renderGroupBreakdown(){
    const wrap = document.getElementById('analysisGroupBars');
    const titleEl = document.getElementById('analysisGroupTitle');
    if(!wrap) return;
    const groups = availableGroups();
    if(!groups.length || !currentGroup){
      wrap.innerHTML = `<p style="color:var(--text-muted); font-size:12.5px;">No categorical columns (broker, grade, garden, etc.) detected in this catalogue.</p>`;
      return;
    }
    const g = groups.find(x=>x.key===currentGroup) || groups[0];
    if(titleEl) titleEl.textContent = `Average Valuation by ${g.label}`;
    const buckets = {};
    lotValuations().forEach(({row,val})=>{
      const k = String(row[g.col]||'').trim() || '(blank)';
      (buckets[k] = buckets[k]||[]).push(val);
    });
    const rows = Object.entries(buckets).map(([k,arr])=>({label:k, avg: mean(arr), n: arr.length}))
      .sort((a,b)=>b.avg-a.avg).slice(0,15);
    const max = rows.length ? Math.max(...rows.map(r=>r.avg)) : 1;
    wrap.innerHTML = rows.map(r=>`<div class="bar-row">
      <div class="bar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${max?(r.avg/max*100):0}%"></div></div>
      <div class="bar-val">${formatCurrency(r.avg,{decimals:2})} <span style="opacity:.6;">(${r.n})</span></div>
    </div>`).join('') || `<p style="color:var(--text-muted); font-size:12.5px;">No valued lots yet for this breakdown.</p>`;
  }

  function renderDistribution(){
    const wrap = document.getElementById('analysisDistribution');
    if(!wrap) return;
    const counts = {best:0, 'below-best':0, poor:0, unclassified:0};
    s.RAW.forEach(row=>{
      const r = s.remarks[rowKeyFor(row)];
      const cls = r && r.classification ? r.classification : 'unclassified';
      counts[cls] = (counts[cls]||0) + 1;
    });
    const labels = {best:'Best', 'below-best':'Below Best', poor:'Poor', unclassified:'Unclassified'};
    const fillClass = {best:'sage', 'below-best':'', poor:'danger', unclassified:''};
    const max = Math.max(...Object.values(counts), 1);
    wrap.innerHTML = Object.entries(counts).map(([k,n])=>`<div class="bar-row">
      <div class="bar-label">${labels[k]}</div>
      <div class="bar-track"><div class="bar-fill ${fillClass[k]}" style="width:${n/max*100}%"></div></div>
      <div class="bar-val">${n.toLocaleString()}</div>
    </div>`).join('');
  }

  function renderTopBottom(){
    const wrap = document.getElementById('analysisTopBottomTable');
    if(!wrap) return;
    const idCol = findHeader(/lot/i, /selling/i);
    const gradeCol = findHeader(/grade/i);
    const gardenCol = findHeader(/garden/i);
    let list = lotValuations().sort((a,b)=> currentTopMode==='top' ? b.val-a.val : a.val-b.val).slice(0,currentTopN);
    if(list.length===0){
      wrap.innerHTML = `<p style="color:var(--text-muted); font-size:12.5px; padding:14px;">No valued lots yet — save some tickets in Catalogue Manager to populate this table.</p>`;
      return;
    }
    wrap.innerHTML = `<table class="mini-table"><thead><tr>
      <th>#</th><th>Lot</th>${gradeCol?'<th>Grade</th>':''}${gardenCol?'<th>Garden</th>':''}<th class="num">Valuation</th><th>Classification</th>
    </tr></thead><tbody>${list.map((x,i)=>{
      const r = s.remarks[x.key] || {};
      const clsMap = {best:'Best','below-best':'Below Best',poor:'Poor'};
      return `<tr>
        <td>${i+1}</td>
        <td class="mono">${escapeHtml(idCol?x.row[idCol]:'—')}</td>
        ${gradeCol?`<td>${escapeHtml(x.row[gradeCol])}</td>`:''}
        ${gardenCol?`<td>${escapeHtml(x.row[gardenCol])}</td>`:''}
        <td class="num mono">${formatCurrency(x.val,{decimals:2})}</td>
        <td>${r.classification ? `<span class="badge ${r.classification}">${clsMap[r.classification]}</span>` : '—'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  function renderDataQuality(){
    const wrap = document.getElementById('analysisDataQuality');
    if(!wrap) return;
    const total = s.RAW.length;
    const missing = s.RAW.filter(row => remarkStatus(rowKeyFor(row))==='empty').length;
    const incomplete = s.RAW.filter(row => s.HEADERS.filter(h=>String(row[h]).trim()==='').length > s.HEADERS.length * 0.3).length;

    const seen = {}; let duplicates = 0;
    s.RAW.forEach(row=>{ const k = rowKeyFor(row); seen[k] = (seen[k]||0)+1; });
    Object.values(seen).forEach(n=>{ if(n>1) duplicates += n; });

    const vals = lotValuations().map(x=>x.val);
    const q = quartiles(vals);
    const iqr = q.q3 - q.q1;
    const lowFence = q.q1 - 1.5*iqr, highFence = q.q3 + 1.5*iqr;
    const outliers = vals.filter(v => v < lowFence || v > highFence).length;

    const cards = [
      {n: missing, lbl:'Missing valuations', cls: missing>0?'warn':''},
      {n: incomplete, lbl:'Incomplete records (30%+ blank fields)', cls: incomplete>0?'warn':''},
      {n: duplicates, lbl:'Possible duplicate lots', cls: duplicates>0?'danger':''},
      {n: isNaN(outliers)?0:outliers, lbl:'Valuation outliers (beyond 1.5×IQR)', cls: outliers>0?'warn':''}
    ];
    wrap.innerHTML = cards.map(c=>`<div class="dq-card ${c.cls}"><div class="dq-num">${c.n.toLocaleString()}</div><div class="dq-lbl">${c.lbl}</div></div>`).join('');
  }

  return { render };
})();
