/* ===================================================================
   ASC.broker — Broker Comparison: rankings, valuation spread,
   grade/category mix, market share.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.broker = (function(){
  const { s, findHeader, rowKeyFor, getValuationValue } = ASC.store;
  const { escapeHtml, formatCurrency, mean } = ASC.utils;

  function render(){
    const empty = document.getElementById('brokerEmpty');
    const content = document.getElementById('brokerContent');
    const noBrokerCol = document.getElementById('brokerNoColumn');
    if(!ASC.store.hasDataset()){
      if(empty) empty.style.display = 'block';
      if(content) content.style.display = 'none';
      if(noBrokerCol) noBrokerCol.style.display = 'none';
      return;
    }
    const brokerCol = findHeader(/broker/i);
    if(!brokerCol){
      if(empty) empty.style.display = 'none';
      if(content) content.style.display = 'none';
      if(noBrokerCol) noBrokerCol.style.display = 'block';
      return;
    }
    if(empty) empty.style.display = 'none';
    if(noBrokerCol) noBrokerCol.style.display = 'none';
    if(content) content.style.display = 'block';

    const gradeCol = findHeader(/grade/i);
    const categoryCol = findHeader(/categ/i);
    const netCol = findHeader(/net.?weight|net.?wt/i);

    const brokers = {};
    s.RAW.forEach(row=>{
      const b = String(row[brokerCol]||'').trim() || '(unspecified)';
      const key = rowKeyFor(row);
      const val = getValuationValue(key);
      if(!brokers[b]) brokers[b] = {lots:0, valued:0, valuations:[], grades:{}, categories:{}, netWeight:0};
      const entry = brokers[b];
      entry.lots++;
      if(val!==null && !isNaN(val)){ entry.valued++; entry.valuations.push(val); }
      if(gradeCol && row[gradeCol]) entry.grades[row[gradeCol]] = (entry.grades[row[gradeCol]]||0)+1;
      if(categoryCol && row[categoryCol]) entry.categories[row[categoryCol]] = (entry.categories[row[categoryCol]]||0)+1;
      if(netCol) entry.netWeight += Number(String(row[netCol]).replace(/,/g,'')) || 0;
    });

    const totalLots = s.RAW.length;
    const rows = Object.entries(brokers).map(([name,e])=>({
      name,
      lots: e.lots,
      share: e.lots/totalLots*100,
      avg: mean(e.valuations),
      max: e.valuations.length ? Math.max(...e.valuations) : NaN,
      min: e.valuations.length ? Math.min(...e.valuations) : NaN,
      valued: e.valued,
      topGrade: topEntry(e.grades),
      topCategory: topEntry(e.categories),
      netWeight: e.netWeight
    })).sort((a,b)=> (isNaN(b.avg)?-Infinity:b.avg) - (isNaN(a.avg)?-Infinity:a.avg));

    renderRanking(rows);
    renderMarketShare(rows, totalLots);
    renderGradeMix(rows, !!gradeCol);
  }

  function topEntry(counts){
    const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    return entries.length ? entries[0][0] : '—';
  }

  function renderRanking(rows){
    const wrap = document.getElementById('brokerRankingTable');
    if(!wrap) return;
    wrap.innerHTML = `<table class="mini-table"><thead><tr>
      <th>#</th><th>Broker</th><th class="num">Lots</th><th class="num">Market Share</th>
      <th class="num">Avg. Valuation</th><th class="num">Highest</th><th class="num">Lowest</th><th>Top Grade</th>
    </tr></thead><tbody>${rows.map((r,i)=>`<tr>
      <td>${i+1}</td>
      <td style="font-weight:600; color:var(--text-strong);">${escapeHtml(r.name)}</td>
      <td class="num mono">${r.lots.toLocaleString()}</td>
      <td class="num mono">${r.share.toFixed(1)}%</td>
      <td class="num mono">${formatCurrency(r.avg,{decimals:2})}</td>
      <td class="num mono">${formatCurrency(r.max,{decimals:2})}</td>
      <td class="num mono">${formatCurrency(r.min,{decimals:2})}</td>
      <td>${escapeHtml(r.topGrade)}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  function renderMarketShare(rows, totalLots){
    const wrap = document.getElementById('brokerMarketShare');
    if(!wrap) return;
    const byShare = [...rows].sort((a,b)=>b.lots-a.lots).slice(0,12);
    const max = byShare.length ? byShare[0].lots : 1;
    wrap.innerHTML = byShare.map(r=>`<div class="bar-row">
      <div class="bar-label" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
      <div class="bar-track"><div class="bar-fill sage" style="width:${r.lots/max*100}%"></div></div>
      <div class="bar-val">${r.lots.toLocaleString()} <span style="opacity:.6;">(${r.share.toFixed(1)}%)</span></div>
    </div>`).join('');
  }

  function renderGradeMix(rows, hasGrade){
    const wrap = document.getElementById('brokerGradeMix');
    if(!wrap) return;
    if(!hasGrade){ wrap.innerHTML = `<p style="color:var(--text-muted); font-size:12.5px;">No Grade column detected in this catalogue.</p>`; return; }
    const byAvg = [...rows].sort((a,b)=>(isNaN(b.avg)?-Infinity:b.avg)-(isNaN(a.avg)?-Infinity:a.avg)).slice(0,12);
    const max = byAvg.length ? Math.max(...byAvg.map(r=>isNaN(r.avg)?0:r.avg)) : 1;
    wrap.innerHTML = byAvg.map(r=>`<div class="bar-row">
      <div class="bar-label" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${max?(isNaN(r.avg)?0:r.avg)/max*100:0}%"></div></div>
      <div class="bar-val">${formatCurrency(r.avg,{decimals:2})}</div>
    </div>`).join('');
  }

  return { render };
})();
