/* ===================================================================
   ASC.dashboard — executive KPI dashboard.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.dashboard = (function(){
  const { s, findHeader, rowKeyFor, remarkStatus, getValuationValue } = ASC.store;
  const { escapeHtml, formatCurrency, formatNumber, mean, timeAgo } = ASC.utils;

  function kpiIcon(name){
    const icons = {
      lots:'<path d="M4 4h16v16H4z"/><path d="M4 9h16"/>',
      check:'<path d="M20 6L9 17l-5-5"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
      trend:'<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>',
      coin:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2-3 2.5-3 1.1-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5"/>',
      scale:'<path d="M12 3v18M5 8l-3 6a3 3 0 006 0zM19 8l-3 6a3 3 0 006 0zM5 8h14M8 3h8"/>',
      user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'
    };
    return icons[name] || icons.lots;
  }

  function tile(opts){
    return `<div class="kpi-tile ${opts.accent?('accent-'+opts.accent):''}">
      <div class="kpi-top">
        <div class="kpi-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${kpiIcon(opts.icon)}</svg></div>
      </div>
      <div class="kpi-num">${opts.num}</div>
      <div class="kpi-lbl">${escapeHtml(opts.label)}</div>
    </div>`;
  }

  function mostCommon(colRe){
    const col = findHeader(colRe);
    if(!col) return null;
    const counts = {};
    s.RAW.forEach(d=>{ const v=String(d[col]||'').trim(); if(v) counts[v]=(counts[v]||0)+1; });
    const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    return entries.length ? {value:entries[0][0], count:entries[0][1], col} : null;
  }

  function computeStats(){
    const total = s.RAW.length;
    const keys = s.RAW.map(rowKeyFor);
    const statuses = keys.map(remarkStatus);
    const completed = statuses.filter(x=>x==='full').length;
    const pending = statuses.filter(x=>x==='empty').length;
    const inProgress = statuses.filter(x=>x==='partial').length;

    const today = new Date(); today.setHours(0,0,0,0);
    const todayCount = keys.filter(k=>{
      const r = s.remarks[k];
      return r && r.updatedAt && r.updatedAt >= today.getTime();
    }).length;

    const valuations = keys.map(getValuationValue).filter(v=>v!==null && !isNaN(v));
    const avgVal = mean(valuations);
    const maxVal = valuations.length ? Math.max(...valuations) : NaN;
    const minVal = valuations.length ? Math.min(...valuations) : NaN;

    const rangeWidths = keys.map(k=>{
      const r = s.remarks[k];
      if(r && r.valuationFrom!=='' && r.valuationTo!=='' && r.valuationFrom!==undefined && r.valuationTo!==undefined){
        return Number(r.valuationTo) - Number(r.valuationFrom);
      }
      return NaN;
    });
    const avgRangeWidth = mean(rangeWidths);

    const brokerCol = findHeader(/broker/i);
    let mostActiveBroker = null;
    if(brokerCol){
      const counts = {};
      s.RAW.forEach(d=>{ const v=String(d[brokerCol]||'').trim(); if(v) counts[v]=(counts[v]||0)+1; });
      const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
      mostActiveBroker = entries[0] ? entries[0][0] : null;
    }

    const netCol = findHeader(/net.?weight|net.?wt/i);
    const grossCol = findHeader(/gross.?weight|gross.?wt/i);
    const sumCol = c => c ? s.RAW.reduce((sum,d)=> sum + (Number(String(d[c]).replace(/,/g,''))||0), 0) : NaN;
    const avgCol = c => c ? mean(s.RAW.map(d=>Number(String(d[c]).replace(/,/g,'')))) : NaN;
    const totalNet = sumCol(netCol), totalGross = sumCol(grossCol);
    const avgNet = avgCol(netCol), avgGross = avgCol(grossCol);

    const grade = mostCommon(/grade/i);
    const category = mostCommon(/categ/i);
    const elevation = mostCommon(/elevat/i);

    let largestSale = null;
    if(netCol){
      let best=null, bestW=-Infinity;
      s.RAW.forEach(d=>{ const w = Number(String(d[netCol]).replace(/,/g,'')); if(!isNaN(w) && w>bestW){ bestW=w; best=d; } });
      largestSale = best;
    }

    return {
      total, completed, pending, inProgress, todayCount,
      avgVal, maxVal, minVal, avgRangeWidth, mostActiveBroker,
      totalNet, totalGross, avgNet, avgGross, grade, category, elevation, largestSale, netCol
    };
  }

  function render(){
    const wrap = document.getElementById('dashboardKpis');
    if(!wrap) return;
    if(!ASC.store.hasDataset()){
      wrap.innerHTML = '';
      document.getElementById('dashboardEmpty').style.display = 'block';
      document.getElementById('dashboardContent').style.display = 'none';
      return;
    }
    document.getElementById('dashboardEmpty').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';

    const st = computeStats();
    const filteredCount = ASC.table.sortRows(ASC.table.getFiltered()).length;

    const section = (title, sub, tilesHtml, compact) => `<div class="kpi-section">
      <div class="kpi-section-head"><h4>${title}</h4>${sub?`<span class="kpi-section-sub">${sub}</span>`:''}</div>
      <div class="kpi-grid${compact?' compact':''}">${tilesHtml.join('')}</div>
    </div>`;

    const progressTiles = [
      tile({icon:'lots', label:'Total Lots', num: st.total.toLocaleString(), accent:'liquor'}),
      tile({icon:'lots', label:'Filtered Lots', num: filteredCount.toLocaleString()}),
      tile({icon:'clock', label:'Pending Valuations', num: st.pending.toLocaleString()}),
      tile({icon:'check', label:'Completed Valuations', num: st.completed.toLocaleString(), accent:'sage'}),
      tile({icon:'trend', label:"Today's Progress", num: st.todayCount.toLocaleString() + ' tickets', accent:'info'})
    ];

    const valuationTiles = [
      tile({icon:'coin', label:'Average Valuation', num: formatCurrency(st.avgVal, {decimals:2}), accent:'info'}),
      tile({icon:'coin', label:'Highest Valuation', num: formatCurrency(st.maxVal, {decimals:2})}),
      tile({icon:'coin', label:'Lowest Valuation', num: formatCurrency(st.minVal, {decimals:2})}),
      tile({icon:'scale', label:'Average Range Width', num: isNaN(st.avgRangeWidth) ? '—' : formatCurrency(st.avgRangeWidth, {decimals:2})})
    ];

    const compositionTiles = [
      tile({icon:'user', label:'Most Active Broker', num: st.mostActiveBroker || '—'}),
      tile({icon:'lots', label:'Most Common Grade', num: st.grade ? st.grade.value : '—'}),
      tile({icon:'lots', label:'Most Common Category', num: st.category ? st.category.value : '—'}),
      tile({icon:'lots', label:'Most Common Elevation', num: st.elevation ? st.elevation.value : '—'}),
      tile({icon:'scale', label:'Largest Sale (Net Wt)', num: (st.largestSale && st.netCol) ? formatNumber(Number(String(st.largestSale[st.netCol]).replace(/,/g,'')),1)+' kg' : '—'})
    ];

    const weightTiles = [
      tile({icon:'scale', label:'Total Net Weight', num: isNaN(st.totalNet) ? '—' : formatNumber(st.totalNet,0)+' kg'}),
      tile({icon:'scale', label:'Total Gross Weight', num: isNaN(st.totalGross) ? '—' : formatNumber(st.totalGross,0)+' kg'}),
      tile({icon:'scale', label:'Average Net Weight', num: isNaN(st.avgNet) ? '—' : formatNumber(st.avgNet,1)+' kg'}),
      tile({icon:'scale', label:'Average Gross Weight', num: isNaN(st.avgGross) ? '—' : formatNumber(st.avgGross,1)+' kg'})
    ];

    wrap.innerHTML =
      section('Coverage &amp; Progress', 'How much of the catalogue is valued', progressTiles) +
      section('Valuation', 'Across all valued lots', valuationTiles) +
      section('Portfolio Composition', null, compositionTiles) +
      section('Weight &amp; Volume', null, weightTiles, true);

    renderRecentActivity();
    renderRecentImports();
    renderQuickContinue();
  }

  function renderRecentActivity(){
    const el = document.getElementById('dashboardActivity');
    if(!el) return;
    const entries = Object.entries(s.remarks)
      .filter(([k,r])=>r.updatedAt)
      .sort((a,b)=>b[1].updatedAt-a[1].updatedAt)
      .slice(0,8);
    if(entries.length===0){ el.innerHTML = `<div class="dd-empty">No ticket activity yet — open a lot and save a ticket to see it here.</div>`; return; }
    el.innerHTML = entries.map(([key,r])=>{
      const row = s.RAW.find(d=>rowKeyFor(d)===key);
      const idCol = findHeader(/lot/i, /selling/i);
      const label = row && idCol ? ('Lot ' + row[idCol]) : 'Lot ticket';
      const cls = r.classification ? ` · <span class="badge ${r.classification}" style="padding:1px 7px;">${r.classification}</span>` : '';
      return `<div class="dd-item">
        <div class="dd-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></div>
        <div><div class="dd-title">${escapeHtml(label)}</div><div class="dd-sub">Updated ${timeAgo(r.updatedAt)}${cls}</div></div>
      </div>`;
    }).join('');
  }

  function renderRecentImports(){
    const el = document.getElementById('dashboardImports');
    if(!el) return;
    ASC.store.loadRecentImports();
    if(s.recentImports.length===0){ el.innerHTML = `<div class="dd-empty">No catalogues imported yet.</div>`; return; }
    el.innerHTML = s.recentImports.slice(0,6).map(imp=>`<div class="dd-item">
      <div class="dd-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/></svg></div>
      <div><div class="dd-title">${escapeHtml(imp.name)}</div><div class="dd-sub">${imp.rows.toLocaleString()} lots · ${imp.columns} columns · ${timeAgo(imp.importedAt)}</div></div>
    </div>`).join('');
  }

  function renderQuickContinue(){
    const el = document.getElementById('dashboardContinue');
    if(!el) return;
    if(!s.recentlyViewed || s.recentlyViewed.length===0){ el.innerHTML = `<div class="dd-empty">Open a lot ticket to see it here for quick access.</div>`; return; }
    el.innerHTML = s.recentlyViewed.slice(0,6).map(v=>`<div class="dd-item" style="cursor:pointer;" data-key="${v.key}">
      <div class="dd-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
      <div><div class="dd-title">${escapeHtml(v.title)}</div><div class="dd-sub">Viewed ${timeAgo(v.at)}</div></div>
    </div>`).join('');
    el.querySelectorAll('[data-key]').forEach(item=>{
      item.addEventListener('click', ()=>{
        ASC.router.go('catalogue');
        ASC.drawer.open(item.dataset.key);
      });
    });
  }

  return { render, computeStats };
})();
