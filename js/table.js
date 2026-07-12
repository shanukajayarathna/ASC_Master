/* ===================================================================
   ASC.table — catalogue grid: render, sort, paginate, quick edit,
   bulk select, freeze columns, CSV/Excel export.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.table = (function(){
  const { s, findHeader, rowKeyFor, remarkStatus, getValuationValue } = ASC.store;
  const { escapeHtml, formatCurrency, showToast, downloadBlob, csvEscape } = ASC.utils;

  function getFiltered(){
    return ASC.filters.applyToRows(s.RAW);
  }

  function sortRows(rows){
    if(!s.filters.sortKey) return rows;
    const {sortKey, sortDir} = s.filters;
    return [...rows].sort((a,b)=>{
      let av=a[sortKey], bv=b[sortKey];
      const an=Number(String(av).replace(/,/g,'')), bn=Number(String(bv).replace(/,/g,''));
      if(!isNaN(an) && !isNaN(bn) && String(av).trim()!=='' && String(bv).trim()!==''){ av=an; bv=bn; }
      if(av<bv) return -1*sortDir;
      if(av>bv) return 1*sortDir;
      return 0;
    });
  }

  function buildHead(){
    const tr = document.getElementById('theadRow');
    if(!tr) return;
    const cols = ASC.columns.visibleHeaders();
    let leftOffset = 34; // checkbox col width
    const frozenOffsets = {};
    cols.forEach(h=>{
      if(ASC.columns.isFrozen(h)){ frozenOffsets[h] = leftOffset; leftOffset += (s.columnLayout.widths[h] || 130); }
    });

    tr.innerHTML = `<th class="checkbox-col frozen" style="left:0;"><input type="checkbox" id="selectAllRows"></th>` +
      cols.map(h=>{
        const num = s.COL_META[h].numeric;
        const frozen = ASC.columns.isFrozen(h);
        const width = s.columnLayout.widths[h];
        const style = (width ? `width:${width}px;` : '') + (frozen ? `left:${frozenOffsets[h]}px;` : '');
        return `<th data-key="${escapeHtml(h)}" class="${num?'num':''} ${frozen?'frozen':''}" style="${style}">${escapeHtml(h)} <span class="arrow">↑</span></th>`;
      }).join('') + `<th>Classification</th><th>Ticket</th><th></th>`;

    tr.querySelectorAll('th[data-key]').forEach(th=>{
      th.addEventListener('click', (e)=>{
        if(e.target.classList.contains('col-resize-grip')) return;
        const key = th.dataset.key;
        if(s.filters.sortKey===key){ s.filters.sortDir *= -1; } else { s.filters.sortKey = key; s.filters.sortDir = 1; }
        render();
      });
      ASC.columns.attachResize(th, th.dataset.key);
    });

    document.getElementById('selectAllRows').addEventListener('change', (e)=>{
      const pageRows = currentPageRows();
      if(e.target.checked) pageRows.forEach(d=> s.selectedRowKeys.add(rowKeyFor(d)));
      else pageRows.forEach(d=> s.selectedRowKeys.delete(rowKeyFor(d)));
      render();
    });
  }

  let lastPageRows = [];
  function currentPageRows(){ return lastPageRows; }

  function classBadge(key){
    const r = s.remarks[key];
    if(!r || !r.classification) return `<span class="badge">—</span>`;
    const map = {best:'Best', 'below-best':'Below Best', poor:'Poor'};
    return `<span class="badge ${r.classification}">${map[r.classification]}</span>`;
  }

  function rowHtml(d, idCol){
    const key = rowKeyFor(d);
    const st = remarkStatus(key);
    const cols = ASC.columns.visibleHeaders();
    const selected = s.selectedRowKeys.has(key);
    let leftOffset = 34;
    const cells = cols.map(h=>{
      const meta = s.COL_META[h];
      const frozen = ASC.columns.isFrozen(h);
      const cls = [(h===idCol ? 'identifier' : (meta.numeric ? 'num mono' : '')), 'editable', frozen?'frozen':''].filter(Boolean).join(' ');
      const width = s.columnLayout.widths[h];
      let style = width ? `width:${width}px;` : '';
      if(frozen){ style += `left:${leftOffset}px;`; leftOffset += (width || 130); }
      return `<td class="${cls}" style="${style}" data-key="${escapeHtml(key)}" data-col="${escapeHtml(h)}">${escapeHtml(d[h])}</td>`;
    }).join('');
    return `<tr class="${selected?'selected':''}" data-key="${escapeHtml(key)}">
      <td class="checkbox-col frozen" style="left:0;"><input type="checkbox" class="row-select" data-key="${escapeHtml(key)}" ${selected?'checked':''}></td>
      ${cells}
      <td>${classBadge(key)}</td>
      <td><span class="status-dot ${st}"></span>${st==='full'?'Complete':st==='partial'?'In progress':'—'}</td>
      <td><button class="row-open" data-key="${escapeHtml(key)}">Open ticket →</button></td>
    </tr>`;
  }

  function render(){
    if(!ASC.store.hasDataset()) return;
    const filtered = sortRows(getFiltered());
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total/s.filters.pageSize));
    if(s.filters.page>pages) s.filters.page = pages;
    const start = (s.filters.page-1)*s.filters.pageSize;
    lastPageRows = filtered.slice(start, start+s.filters.pageSize);

    buildHead();

    document.getElementById('theadRow').querySelectorAll('th[data-key]').forEach(th=>{
      th.classList.toggle('sorted', th.dataset.key===s.filters.sortKey);
      const arrow = th.querySelector('.arrow');
      if(arrow) arrow.textContent = (th.dataset.key===s.filters.sortKey && s.filters.sortDir===-1) ? '↓' : '↑';
    });

    const tbody = document.getElementById('tbody');
    const emptyState = document.getElementById('emptyState');
    const idCol = findHeader(/lot/i, /selling/i);
    if(lastPageRows.length===0){
      tbody.innerHTML='';
      emptyState.style.display='block';
    } else {
      emptyState.style.display='none';
      tbody.innerHTML = lastPageRows.map(d=>rowHtml(d, idCol)).join('');
      bindRowEvents();
    }

    const selectAll = document.getElementById('selectAllRows');
    if(selectAll){
      const allSelected = lastPageRows.length>0 && lastPageRows.every(d=>s.selectedRowKeys.has(rowKeyFor(d)));
      selectAll.checked = allSelected;
    }

    renderActiveFilterPills();
    const activeCount = ASC.filters.activeCount();
    const countEl = document.getElementById('filterCount');
    if(countEl){ countEl.textContent = activeCount; countEl.classList.toggle('show', activeCount > 0); }
    document.getElementById('filterMeta').textContent = `${total.toLocaleString()} of ${s.RAW.length.toLocaleString()} lots`;
    document.getElementById('pInfo').textContent = total===0 ? 'No results' : `Showing ${start+1}–${Math.min(start+s.filters.pageSize,total)} of ${total.toLocaleString()}`;
    document.getElementById('pCur').textContent = `${s.filters.page} / ${pages}`;
    document.getElementById('firstPage').disabled = s.filters.page<=1;
    document.getElementById('prevPage').disabled = s.filters.page<=1;
    document.getElementById('nextPage').disabled = s.filters.page>=pages;
    document.getElementById('lastPage').disabled = s.filters.page>=pages;

    renderBulkToolbar();
  }

  function bindRowEvents(){
    document.querySelectorAll('.row-open').forEach(btn=>{
      btn.addEventListener('click', ()=> ASC.drawer.open(btn.dataset.key));
    });
    document.querySelectorAll('.row-select').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        if(cb.checked) s.selectedRowKeys.add(cb.dataset.key); else s.selectedRowKeys.delete(cb.dataset.key);
        cb.closest('tr').classList.toggle('selected', cb.checked);
        renderBulkToolbar();
        const selectAll = document.getElementById('selectAllRows');
        if(selectAll) selectAll.checked = lastPageRows.every(d=>s.selectedRowKeys.has(rowKeyFor(d)));
      });
    });
    // quick edit: double-click a cell to edit inline (only non-derived source columns)
    document.querySelectorAll('td.editable').forEach(td=>{
      td.addEventListener('dblclick', ()=> startEdit(td));
    });
  }

  function startEdit(td){
    if(td.classList.contains('editing')) return;
    const key = td.dataset.key, col = td.dataset.col;
    const row = s.RAW.find(r=>rowKeyFor(r)===key);
    if(!row) return;
    const original = row[col];
    td.classList.add('editing');
    td.innerHTML = `<input type="text" value="${escapeHtml(original)}">`;
    const input = td.querySelector('input');
    input.focus(); input.select();
    function commit(){
      row[col] = input.value;
      td.classList.remove('editing');
      render();
      showToast('Cell updated');
    }
    function cancel(){ td.classList.remove('editing'); render(); }
    input.addEventListener('keydown', e=>{
      if(e.key==='Enter') commit();
      else if(e.key==='Escape') cancel();
      else if(e.key==='Tab'){ e.preventDefault(); commit(); focusNextEditable(td); }
    });
    input.addEventListener('blur', commit);
  }

  function focusNextEditable(td){
    const all = [...document.querySelectorAll('td.editable')];
    const idx = all.indexOf(td);
    const next = all[idx+1];
    if(next) startEdit(next);
  }

  function renderActiveFilterPills(){
    const wrap = document.getElementById('activeFilters');
    const pills = ASC.filters.pillsFor();
    wrap.innerHTML = pills.map((p,i)=>`<span class="pill" data-i="${i}">${escapeHtml(p.label)} <button data-i="${i}">✕</button></span>`).join('');
    wrap.querySelectorAll('button').forEach((btn,i)=>{
      btn.addEventListener('click', ()=> pills[i].onRemove());
    });
  }

  /* ---------- bulk toolbar ---------- */
  function renderBulkToolbar(){
    const bar = document.getElementById('bulkToolbar');
    if(!bar) return;
    const n = s.selectedRowKeys.size;
    bar.classList.toggle('show', n>0);
    document.getElementById('bulkCount').textContent = n + (n===1 ? ' lot selected' : ' lots selected');
  }

  function clearSelection(){ s.selectedRowKeys.clear(); render(); }

  function bulkClassify(cls){
    s.selectedRowKeys.forEach(key=>{
      const r = s.remarks[key] || {};
      r.classification = cls;
      r.updatedAt = Date.now();
      s.remarks[key] = r;
    });
    ASC.store.persistRemarks();
    render();
    showToast(`Classified ${s.selectedRowKeys.size} lots`);
  }

  function bulkDeleteNotes(){
    s.selectedRowKeys.forEach(key=>{ delete s.remarks[key]; });
    ASC.store.persistRemarks();
    render();
    showToast('Notes cleared for selected lots');
  }

  function bulkExport(){
    exportCsv(s.RAW.filter(d=>s.selectedRowKeys.has(rowKeyFor(d))));
  }

  function bulkPrint(){
    window.print();
  }

  /* ---------- export ---------- */
  function exportCsv(rowsOverride){
    const rows = rowsOverride || sortRows(getFiltered());
    const headers = [...s.HEADERS, 'Classification','ValuationFrom','ValuationTo','ValuationSingle','StandardData','AdjectiveData','LiquorRemarks','BrokerNotes','PrivateNotes','MusterReport'];
    const lines = [headers.map(h=>csvEscape(h)).join(',')];
    rows.forEach(d=>{
      const key = rowKeyFor(d);
      const r = s.remarks[key] || {};
      const vals = [...s.HEADERS.map(h=>d[h]), r.classification||'', r.valuationFrom||'', r.valuationTo||'', r.valuationSingle||'', r.standardData||'', r.adjectiveData||'', r.liquorRemarks||'', r.brokerNotes||'', r.privateNotes||'', r.musterReport||'']
        .map(v=>csvEscape(v));
      lines.push(vals.join(','));
    });
    downloadBlob(lines.join('\n'), (s.SOURCE_NAME.replace(/\.[^.]+$/,'') || 'catalogue') + '_export.csv', 'text/csv;charset=utf-8;');
    showToast('Catalogue exported to CSV');
  }

  function exportExcel(rowsOverride){
    const rows = rowsOverride || sortRows(getFiltered());
    const headers = [...s.HEADERS, 'Classification','ValuationFrom','ValuationTo','ValuationSingle','StandardData','AdjectiveData','LiquorRemarks','MusterReport'];
    const data = rows.map(d=>{
      const key = rowKeyFor(d);
      const r = s.remarks[key] || {};
      const obj = {};
      s.HEADERS.forEach(h=> obj[h]=d[h]);
      obj.Classification = r.classification||'';
      obj.ValuationFrom = r.valuationFrom||'';
      obj.ValuationTo = r.valuationTo||'';
      obj.ValuationSingle = r.valuationSingle||'';
      obj.StandardData = r.standardData||'';
      obj.AdjectiveData = r.adjectiveData||'';
      obj.LiquorRemarks = r.liquorRemarks||'';
      obj.MusterReport = r.musterReport||'';
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(data, {header:headers});
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');
    XLSX.writeFile(wb, (s.SOURCE_NAME.replace(/\.[^.]+$/,'') || 'catalogue') + '_export.xlsx');
    showToast('Catalogue exported to Excel');
  }

  return {
    getFiltered, sortRows, render, clearSelection, bulkClassify, bulkDeleteNotes, bulkExport, bulkPrint,
    exportCsv, exportExcel
  };
})();
