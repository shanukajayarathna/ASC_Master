/* ===================================================================
   ASC.reports — Report Builder: generate, preview, print/export and
   save executive/broker/grade/category/garden/valuation reports.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.reports = (function(){
  const { s, findHeader, rowKeyFor, getValuationValue } = ASC.store;
  const { escapeHtml, formatCurrency, formatNumber, mean, median, uid } = ASC.utils;

  const REPORT_TYPES = {
    executive: 'Executive Summary',
    broker: 'Broker Summary',
    grade: 'Grade Summary',
    category: 'Category Summary',
    garden: 'Garden Summary',
    classification: 'Classification Report',
    valuation: 'Valuation Analysis',
    market: 'Market Analysis',
    custom: 'Custom (current filtered view)'
  };

  let lastGenerated = null;

  function groupAvg(col){
    const buckets = {};
    s.RAW.forEach(row=>{
      const val = getValuationValue(rowKeyFor(row));
      if(val===null || isNaN(val)) return;
      const k = String(row[col]||'').trim() || '(blank)';
      (buckets[k]=buckets[k]||[]).push(val);
    });
    return Object.entries(buckets).map(([label,arr])=>({label, avg: mean(arr), n: arr.length})).sort((a,b)=>b.avg-a.avg);
  }

  function reportHeader(title, subtitle){
    return `<div class="report-letterhead">
      <div class="report-brand">Asia Siyaka Commodities</div>
      <div class="report-brand-sub">Tea Auction Valuation &amp; Business Intelligence</div>
      <h2>${escapeHtml(title)}</h2>
      <p class="report-meta">${escapeHtml(subtitle)} · Generated ${new Date().toLocaleString()} · Source: ${escapeHtml(s.SOURCE_NAME||'—')}</p>
    </div>`;
  }

  function groupTable(title, rows, unitLabel){
    return `<h3 class="report-section-title">${escapeHtml(title)}</h3>
    <table class="mini-table" style="margin-bottom:20px;"><thead><tr><th>${escapeHtml(unitLabel)}</th><th class="num">Lots Valued</th><th class="num">Average Valuation</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.label)}</td><td class="num mono">${r.n}</td><td class="num mono">${formatCurrency(r.avg,{decimals:2})}</td></tr>`).join('') || `<tr><td colspan="3" style="color:var(--text-muted);">No valued lots yet.</td></tr>`}</tbody></table>`;
  }

  function generate(type){
    const st = ASC.dashboard.computeStats();
    let html = '';
    if(type==='executive'){
      html = reportHeader('Executive Summary', 'Full catalogue overview') + `
        <div class="kpi-grid compact">
          ${['Total Lots','Completed','Pending'].map((l,i)=>`<div class="kpi-tile"><div class="kpi-num">${[st.total,st.completed,st.pending][i].toLocaleString()}</div><div class="kpi-lbl">${l}</div></div>`).join('')}
          <div class="kpi-tile"><div class="kpi-num">${formatCurrency(st.avgVal,{decimals:2})}</div><div class="kpi-lbl">Average Valuation</div></div>
          <div class="kpi-tile"><div class="kpi-num">${formatCurrency(st.maxVal,{decimals:2})}</div><div class="kpi-lbl">Highest Valuation</div></div>
          <div class="kpi-tile"><div class="kpi-num">${formatCurrency(st.minVal,{decimals:2})}</div><div class="kpi-lbl">Lowest Valuation</div></div>
        </div>` +
        (findHeader(/broker/i) ? groupTable('By Broker', groupAvg(findHeader(/broker/i)), 'Broker') : '') +
        (findHeader(/grade/i) ? groupTable('By Grade', groupAvg(findHeader(/grade/i)), 'Grade') : '');
    } else if(type==='broker' && findHeader(/broker/i)){
      html = reportHeader('Broker Summary', 'Average valuation and lot count per broker') + groupTable('Brokers', groupAvg(findHeader(/broker/i)), 'Broker');
    } else if(type==='grade' && findHeader(/grade/i)){
      html = reportHeader('Grade Summary', 'Average valuation per grade') + groupTable('Grades', groupAvg(findHeader(/grade/i)), 'Grade');
    } else if(type==='category' && findHeader(/categ/i)){
      html = reportHeader('Category Summary', 'Average valuation per category') + groupTable('Categories', groupAvg(findHeader(/categ/i)), 'Category');
    } else if(type==='garden' && findHeader(/garden/i)){
      html = reportHeader('Garden Summary', 'Average valuation per garden') + groupTable('Gardens', groupAvg(findHeader(/garden/i)), 'Garden');
    } else if(type==='classification'){
      const counts = {best:0,'below-best':0,poor:0,unclassified:0};
      s.RAW.forEach(row=>{ const r=s.remarks[rowKeyFor(row)]; counts[(r&&r.classification)||'unclassified']++; });
      const labels = {best:'Best','below-best':'Below Best',poor:'Poor',unclassified:'Unclassified'};
      html = reportHeader('Classification Report', 'Lot count by classification') +
        `<table class="mini-table"><thead><tr><th>Classification</th><th class="num">Lots</th><th class="num">% of Total</th></tr></thead><tbody>
        ${Object.entries(counts).map(([k,n])=>`<tr><td>${labels[k]}</td><td class="num mono">${n}</td><td class="num mono">${st.total?(n/st.total*100).toFixed(1):'0.0'}%</td></tr>`).join('')}
        </tbody></table>`;
    } else if(type==='valuation'){
      const vals = s.RAW.map(row=>getValuationValue(rowKeyFor(row))).filter(v=>v!==null && !isNaN(v));
      html = reportHeader('Valuation Analysis', 'Distribution of valued lots') + `
        <div class="kpi-grid compact">
          <div class="kpi-tile"><div class="kpi-num">${formatCurrency(mean(vals),{decimals:2})}</div><div class="kpi-lbl">Mean</div></div>
          <div class="kpi-tile"><div class="kpi-num">${formatCurrency(median(vals),{decimals:2})}</div><div class="kpi-lbl">Median</div></div>
          <div class="kpi-tile"><div class="kpi-num">${vals.length ? formatCurrency(Math.max(...vals),{decimals:2}) : '—'}</div><div class="kpi-lbl">Highest</div></div>
          <div class="kpi-tile"><div class="kpi-num">${vals.length ? formatCurrency(Math.min(...vals),{decimals:2}) : '—'}</div><div class="kpi-lbl">Lowest</div></div>
        </div>`;
    } else if(type==='market'){
      html = reportHeader('Market Analysis', 'Estimated vs. actual auction outcomes') +
        `<p style="font-size:12.5px; color:var(--text-muted);">Open Market Intelligence to import actual auction results, then regenerate this report — it will include accuracy %, RMSE and MAPE against your valuations.</p>`;
    } else if(type==='custom'){
      const rows = ASC.table.sortRows(ASC.table.getFiltered());
      const idCol = findHeader(/lot/i, /selling/i);
      const gradeCol = findHeader(/grade/i);
      html = reportHeader('Custom Report', `Current filtered view · ${rows.length.toLocaleString()} lots`) +
        `<table class="mini-table"><thead><tr><th>Lot</th>${gradeCol?'<th>Grade</th>':''}<th class="num">Valuation</th></tr></thead><tbody>
        ${rows.slice(0,200).map(row=>{
          const val = getValuationValue(rowKeyFor(row));
          return `<tr><td class="mono">${escapeHtml(idCol?row[idCol]:'—')}</td>${gradeCol?`<td>${escapeHtml(row[gradeCol])}</td>`:''}<td class="num mono">${val!==null?formatCurrency(val,{decimals:2}):'—'}</td></tr>`;
        }).join('')}
        </tbody></table>${rows.length>200?`<p style="font-size:11.5px; color:var(--text-muted);">Showing first 200 of ${rows.length.toLocaleString()} rows — export CSV/Excel from Catalogue Manager for the full set.</p>`:''}`;
    } else {
      html = reportHeader(REPORT_TYPES[type]||'Report', 'This catalogue does not contain the column this report needs.') +
        `<p style="color:var(--text-muted); font-size:13px;">Try a different report type, or check Column Chooser to confirm the relevant column is present.</p>`;
    }
    lastGenerated = {type, html, generatedAt: Date.now()};
    return html;
  }

  function renderPreview(type){
    const preview = document.getElementById('reportPreview');
    if(!preview) return;
    preview.innerHTML = generate(type);
  }

  function saveCurrentReport(){
    if(!lastGenerated) return;
    ASC.store.loadSavedReports();
    s.savedReports.unshift({
      id: uid('report'),
      type: lastGenerated.type,
      title: REPORT_TYPES[lastGenerated.type] || lastGenerated.type,
      source: s.SOURCE_NAME,
      createdAt: Date.now()
    });
    ASC.store.persistSavedReports();
    ASC.utils.showToast('Report saved');
    if(ASC.savedReports) ASC.savedReports.render();
  }

  function exportReportExcel(){
    if(!lastGenerated) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = lastGenerated.html;
    const table = tmp.querySelector('table');
    if(!table){ ASC.utils.showToast('This report has no tabular data to export'); return; }
    const wb = XLSX.utils.table_to_book(table, {sheet: 'Report'});
    XLSX.writeFile(wb, (REPORT_TYPES[lastGenerated.type]||'report').replace(/\s+/g,'_') + '.xlsx');
  }

  function bindToolbar(){
    const sel = document.getElementById('reportTypeSelect');
    if(sel && sel.dataset.bound!=='1'){
      sel.dataset.bound = '1';
      sel.innerHTML = Object.entries(REPORT_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
      sel.addEventListener('change', ()=> renderPreview(sel.value));
    }
    const printBtn = document.getElementById('reportPrintBtn');
    if(printBtn && printBtn.dataset.bound!=='1'){ printBtn.dataset.bound='1'; printBtn.addEventListener('click', ()=> window.print()); }
    const excelBtn = document.getElementById('reportExcelBtn');
    if(excelBtn && excelBtn.dataset.bound!=='1'){ excelBtn.dataset.bound='1'; excelBtn.addEventListener('click', exportReportExcel); }
    const saveBtn = document.getElementById('reportSaveBtn');
    if(saveBtn && saveBtn.dataset.bound!=='1'){ saveBtn.dataset.bound='1'; saveBtn.addEventListener('click', saveCurrentReport); }
  }

  function render(){
    const empty = document.getElementById('reportsEmpty');
    const content = document.getElementById('reportsContent');
    if(!ASC.store.hasDataset()){
      if(empty) empty.style.display = 'block';
      if(content) content.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    if(content) content.style.display = 'block';
    bindToolbar();
    const sel = document.getElementById('reportTypeSelect');
    renderPreview(sel ? sel.value : 'executive');
  }

  return { render, REPORT_TYPES, generate };
})();
