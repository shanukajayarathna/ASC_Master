/* ===================================================================
   ASC.filters — enterprise filter panel: multiselect dropdowns,
   numeric range filters, keyword search, chips, presets.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.filters = (function(){
  const { s, findHeader, persistFilterPresets } = ASC.store;
  const { escapeHtml, uid } = ASC.utils;

  function activeCount(){
    return Object.keys(s.filters.columnFilters).length + (s.filters.status ? 1 : 0);
  }

  function buildPanel(){
    const grid = document.getElementById('filterPanelGrid');
    if(!grid) return;
    grid.innerHTML = s.HEADERS.map(h=>{
      const meta = s.COL_META[h];
      let inputHtml;
      if(meta.categorical){
        inputHtml = `<div class="msel" data-col="${escapeHtml(h)}">
          <button type="button" class="msel-trigger" data-col="${escapeHtml(h)}"><span class="msel-label">All</span><span class="msel-arrow">▾</span></button>
          <div class="msel-panel" data-col="${escapeHtml(h)}">
            <input type="text" class="msel-search" placeholder="Search ${escapeHtml(h)}…">
            <div class="msel-opts">${meta.options.map(o=>`<label class="msel-opt"><input type="checkbox" value="${escapeHtml(o)}"><span>${escapeHtml(o)}</span></label>`).join('')}</div>
          </div>
        </div>`;
      } else if(meta.numeric){
        inputHtml = `<div class="range-inline">
          <input type="text" class="col-filter" data-col="${escapeHtml(h)}" data-part="min" placeholder="Min">
          <span>–</span>
          <input type="text" class="col-filter" data-col="${escapeHtml(h)}" data-part="max" placeholder="Max">
        </div>`;
      } else {
        inputHtml = `<input type="text" class="col-filter" data-col="${escapeHtml(h)}" placeholder="Contains…">`;
      }
      return `<div class="filter-field"><label title="${escapeHtml(h)}">${escapeHtml(h)}</label>${inputHtml}</div>`;
    }).join('');

    bindInputs();
    renderPresets();
  }

  function bindInputs(){
    // text / contains
    document.querySelectorAll('#filterPanelGrid input.col-filter:not([data-part])').forEach(el=>{
      el.addEventListener('input', ()=>{
        const col = el.dataset.col, val = el.value;
        if(val) s.filters.columnFilters[col] = {type:'text', value:val};
        else delete s.filters.columnFilters[col];
        s.filters.page = 1;
        ASC.table.render();
      });
    });
    // numeric range
    document.querySelectorAll('#filterPanelGrid input.col-filter[data-part]').forEach(el=>{
      el.addEventListener('input', ()=>{
        const col = el.dataset.col;
        const existing = (s.filters.columnFilters[col] && s.filters.columnFilters[col].type==='range') ? s.filters.columnFilters[col] : {type:'range', min:'', max:''};
        existing[el.dataset.part] = el.value;
        if(existing.min==='' && existing.max===''){ delete s.filters.columnFilters[col]; }
        else s.filters.columnFilters[col] = existing;
        s.filters.page = 1;
        ASC.table.render();
      });
    });
    // multi-select dropdowns
    document.querySelectorAll('.msel-trigger').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        document.querySelectorAll('.msel-panel.show').forEach(p=>{ if(p.dataset.col!==btn.dataset.col) p.classList.remove('show'); });
        const panel = document.querySelector(`.msel-panel[data-col="${cssEsc(btn.dataset.col)}"]`);
        panel.classList.toggle('show');
      });
    });
    document.querySelectorAll('.msel-search').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const q = inp.value.toLowerCase();
        inp.parentElement.querySelectorAll('.msel-opt').forEach(opt=>{
          opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    });
    document.querySelectorAll('.msel-panel').forEach(panel=>{
      panel.addEventListener('change', ()=>{
        const col = panel.dataset.col;
        const checked = [...panel.querySelectorAll('input:checked')].map(c=>c.value);
        const trigger = document.querySelector(`.msel-trigger[data-col="${cssEsc(col)}"] .msel-label`);
        if(checked.length===0){
          delete s.filters.columnFilters[col];
          trigger.textContent = 'All';
        } else {
          s.filters.columnFilters[col] = {type:'set', values:checked};
          trigger.textContent = checked.length===1 ? checked[0] : checked.length + ' selected';
        }
        document.querySelector(`.msel-trigger[data-col="${cssEsc(col)}"]`).classList.toggle('active', checked.length>0);
        s.filters.page = 1;
        ASC.table.render();
      });
    });
    document.addEventListener('click', ()=> document.querySelectorAll('.msel-panel.show').forEach(p=>p.classList.remove('show')));
  }

  function cssEsc(v){ return v.replace(/(["\\])/g,'\\$1'); }

  function syncInputs(){
    document.querySelectorAll('#filterPanelGrid input.col-filter:not([data-part])').forEach(el=>{
      const f = s.filters.columnFilters[el.dataset.col];
      el.value = (f && f.type==='text') ? f.value : '';
    });
    document.querySelectorAll('#filterPanelGrid input.col-filter[data-part]').forEach(el=>{
      const f = s.filters.columnFilters[el.dataset.col];
      el.value = (f && f.type==='range') ? (f[el.dataset.part]||'') : '';
    });
    document.querySelectorAll('.msel-panel').forEach(panel=>{
      const col = panel.dataset.col;
      const f = s.filters.columnFilters[col];
      const values = (f && f.type==='set') ? f.values : [];
      panel.querySelectorAll('input').forEach(cb=> cb.checked = values.includes(cb.value));
      const trigger = document.querySelector(`.msel-trigger[data-col="${cssEsc(col)}"] .msel-label`);
      if(trigger) trigger.textContent = values.length===0 ? 'All' : (values.length===1 ? values[0] : values.length + ' selected');
    });
  }

  function applyToRows(rows){
    const q = s.filters.search.trim().toLowerCase();
    if(q) rows = rows.filter(d => s.HEADERS.some(h => String(d[h]).toLowerCase().includes(q)));

    Object.entries(s.filters.columnFilters).forEach(([col,f])=>{
      if(f.type==='set'){
        const set = new Set(f.values);
        rows = rows.filter(d => set.has(String(d[col])));
      } else if(f.type==='range'){
        rows = rows.filter(d=>{
          const n = Number(String(d[col]).replace(/,/g,''));
          if(isNaN(n)) return false;
          if(f.min!=='' && n < Number(f.min)) return false;
          if(f.max!=='' && n > Number(f.max)) return false;
          return true;
        });
      } else if(f.type==='text'){
        const v = f.value.toLowerCase();
        rows = rows.filter(d => String(d[col]).toLowerCase().includes(v));
      }
    });

    if(s.filters.status){
      rows = rows.filter(d => ASC.store.remarkStatus(ASC.store.rowKeyFor(d)) === s.filters.status);
    }
    return rows;
  }

  function clearAll(){
    s.filters.search=''; s.filters.columnFilters={}; s.filters.status=''; s.filters.page=1;
    const si = document.getElementById('searchInput'); if(si) si.value='';
    const ss = document.getElementById('statusSelect'); if(ss) ss.value='';
    syncInputs();
    ASC.table.render();
  }

  function pillsFor(){
    const pills = [];
    Object.entries(s.filters.columnFilters).forEach(([col,f])=>{
      let label;
      if(f.type==='set') label = `${col}: ${f.values.length===1?f.values[0]:f.values.length+' selected'}`;
      else if(f.type==='range') label = `${col}: ${f.min||'…'}–${f.max||'…'}`;
      else label = `${col}: ${f.value}`;
      pills.push({label, onRemove:()=>{ delete s.filters.columnFilters[col]; syncInputs(); ASC.table.render(); }});
    });
    if(s.filters.status){
      pills.push({label:`Ticket: ${s.filters.status}`, onRemove:()=>{ s.filters.status=''; const ss=document.getElementById('statusSelect'); if(ss) ss.value=''; ASC.table.render(); }});
    }
    return pills;
  }

  /* ---------- presets ---------- */
  function savePreset(name){
    s.filterPresets.push({
      id: uid('preset'),
      name,
      columnFilters: JSON.parse(JSON.stringify(s.filters.columnFilters)),
      status: s.filters.status,
      search: s.filters.search,
      createdAt: Date.now()
    });
    persistFilterPresets();
    renderPresets();
  }
  function applyPreset(id){
    const p = s.filterPresets.find(p=>p.id===id);
    if(!p) return;
    s.filters.columnFilters = JSON.parse(JSON.stringify(p.columnFilters));
    s.filters.status = p.status;
    s.filters.search = p.search;
    s.filters.page = 1;
    const si = document.getElementById('searchInput'); if(si) si.value = p.search;
    const ss = document.getElementById('statusSelect'); if(ss) ss.value = p.status;
    syncInputs();
    ASC.table.render();
    ASC.utils.showToast(`Applied filter preset "${p.name}"`);
  }
  function deletePreset(id){
    s.filterPresets = s.filterPresets.filter(p=>p.id!==id);
    persistFilterPresets();
    renderPresets();
  }
  function renderPresets(){
    const wrap = document.getElementById('filterPresetsRow');
    if(!wrap) return;
    if(s.filterPresets.length===0){ wrap.innerHTML = ''; return; }
    wrap.innerHTML = `<span class="fp-label">Saved presets</span>` + s.filterPresets.map(p=>
      `<span class="preset-chip" data-id="${p.id}"><span class="preset-apply" data-id="${p.id}">${escapeHtml(p.name)}</span><button data-id="${p.id}" title="Delete preset">✕</button></span>`
    ).join('');
    wrap.querySelectorAll('.preset-apply').forEach(el=> el.addEventListener('click', ()=> applyPreset(el.dataset.id)));
    wrap.querySelectorAll('button[data-id]').forEach(el=> el.addEventListener('click', (e)=>{ e.stopPropagation(); deletePreset(el.dataset.id); }));
  }

  function renderSavedFiltersPage(){
    const empty = document.getElementById('savedFiltersEmpty');
    const list = document.getElementById('savedFiltersList');
    if(!list) return;
    if(!ASC.store.hasDataset() || s.filterPresets.length===0){
      if(empty) empty.style.display = 'block';
      list.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    list.style.display = 'block';
    list.innerHTML = s.filterPresets.map(p=>`<div class="recent-import-item">
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="meta">${Object.keys(p.columnFilters).length} column filter(s)${p.status?' · status: '+p.status:''}</span>
      <button class="btn brass small" data-apply="${p.id}">Apply</button>
      <button class="btn ghost small" data-del="${p.id}">Delete</button>
    </div>`).join('');
    list.querySelectorAll('[data-apply]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        ASC.router.go('catalogue');
        applyPreset(btn.dataset.apply);
      });
    });
    list.querySelectorAll('[data-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ deletePreset(btn.dataset.del); renderSavedFiltersPage(); });
    });
  }

  return { activeCount, buildPanel, syncInputs, applyToRows, clearAll, pillsFor, savePreset, applyPreset, deletePreset, renderPresets, renderSavedFiltersPage };
})();
