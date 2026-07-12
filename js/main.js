/* ===================================================================
   ASC.main — bootstrap: file handling, toolbar wiring, modals,
   keyboard shortcuts, notifications.
   =================================================================== */
window.ASC = window.ASC || {};

(function(){
  const { s } = ASC.store;
  const { showToast } = ASC.utils;

  /* ---------- file import ---------- */
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const errBanner = document.getElementById('errBanner');

  function showError(msg){ errBanner.textContent = msg; errBanner.style.display = 'block'; }
  function clearError(){ errBanner.style.display = 'none'; errBanner.textContent=''; }

  function activateDataset(headers, data, fileName){
    ASC.store.loadDataset(headers, data, fileName);

    document.getElementById('uploadScreen').style.display = 'none';
    document.getElementById('catalogueWorkspace').style.display = 'block';
    document.getElementById('catalogueMeta').textContent = `${fileName} · ${data.length.toLocaleString()} lots · ${headers.length} columns catalogued`;
    document.getElementById('catalogueHeaderActions').style.display = 'flex';

    ASC.filters.buildPanel();
    ASC.table.render();
    ASC.dashboard.render();
    showToast(`Loaded ${data.length.toLocaleString()} lots from ${fileName}`);
  }

  function handleFile(file){
    clearError();
    ASC.parsing.parseFile(file).then(res=>{
      activateDataset(res.headers, res.data, res.fileName);
    }).catch(err=>{
      showError(err.message);
    });
  }

  if(browseBtn) browseBtn.addEventListener('click', ()=> fileInput.click());
  if(dropzone){
    dropzone.addEventListener('click', (e)=>{ if(e.target===browseBtn) return; fileInput.click(); });
    ['dragenter','dragover'].forEach(ev=> dropzone.addEventListener(ev, e=>{ e.preventDefault(); dropzone.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=> dropzone.addEventListener(ev, e=>{ e.preventDefault(); dropzone.classList.remove('drag'); }));
    dropzone.addEventListener('drop', e=>{ const f = e.dataTransfer.files[0]; if(f) handleFile(f); });
  }
  if(fileInput) fileInput.addEventListener('change', e=>{ const f = e.target.files[0]; if(f) handleFile(f); fileInput.value=''; });
  const changeFileBtn = document.getElementById('changeFileBtn');
  if(changeFileBtn) changeFileBtn.addEventListener('click', ()=>{
    document.getElementById('uploadScreen').style.display = 'block';
    document.getElementById('catalogueWorkspace').style.display = 'none';
    document.getElementById('catalogueHeaderActions').style.display = 'none';
  });

  /* ---------- toolbar ---------- */
  const searchInput = document.getElementById('searchInput');
  if(searchInput) searchInput.addEventListener('input', ASC.utils.debounce(e=>{ s.filters.search=e.target.value; s.filters.page=1; ASC.table.render(); }, 150));

  const statusSelect = document.getElementById('statusSelect');
  if(statusSelect) statusSelect.addEventListener('change', e=>{ s.filters.status=e.target.value; s.filters.page=1; ASC.table.render(); });

  const clearFiltersBtn = document.getElementById('clearFiltersBtn');
  if(clearFiltersBtn) clearFiltersBtn.addEventListener('click', ()=> ASC.filters.clearAll());

  const toggleFiltersBtn = document.getElementById('toggleFiltersBtn');
  if(toggleFiltersBtn) toggleFiltersBtn.addEventListener('click', ()=>{
    const panel = document.getElementById('filterPanel');
    const open = panel.classList.toggle('open');
    toggleFiltersBtn.classList.toggle('active', open);
  });
  const collapseFiltersBtn = document.getElementById('collapseFiltersBtn');
  if(collapseFiltersBtn) collapseFiltersBtn.addEventListener('click', ()=>{
    document.getElementById('filterPanel').classList.remove('open');
    toggleFiltersBtn.classList.remove('active');
  });

  const savePresetBtn = document.getElementById('savePresetBtn');
  if(savePresetBtn) savePresetBtn.addEventListener('click', ()=>{
    document.getElementById('savePresetModal').classList.add('show');
    document.getElementById('modalOverlay').classList.add('show');
    document.getElementById('presetNameInput').value = '';
    document.getElementById('presetNameInput').focus();
  });
  const presetModalCancel = document.getElementById('presetModalCancel');
  if(presetModalCancel) presetModalCancel.addEventListener('click', closeModals);
  const presetModalSave = document.getElementById('presetModalSave');
  if(presetModalSave) presetModalSave.addEventListener('click', ()=>{
    const name = document.getElementById('presetNameInput').value.trim();
    if(!name){ showToast('Give the preset a name'); return; }
    ASC.filters.savePreset(name);
    closeModals();
    showToast(`Saved filter preset "${name}"`);
  });

  const pageSizeSelect = document.getElementById('pageSizeSelect');
  if(pageSizeSelect) pageSizeSelect.addEventListener('change', e=>{ s.filters.pageSize=Number(e.target.value); s.filters.page=1; ASC.table.render(); });
  const firstPage = document.getElementById('firstPage'); if(firstPage) firstPage.addEventListener('click', ()=>{ s.filters.page=1; ASC.table.render(); });
  const prevPage = document.getElementById('prevPage'); if(prevPage) prevPage.addEventListener('click', ()=>{ s.filters.page=Math.max(1,s.filters.page-1); ASC.table.render(); });
  const nextPage = document.getElementById('nextPage'); if(nextPage) nextPage.addEventListener('click', ()=>{ s.filters.page+=1; ASC.table.render(); });
  const lastPage = document.getElementById('lastPage'); if(lastPage) lastPage.addEventListener('click', ()=>{ s.filters.page=1e9; ASC.table.render(); });

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if(exportCsvBtn) exportCsvBtn.addEventListener('click', ()=> ASC.table.exportCsv());
  const exportExcelBtn = document.getElementById('exportExcelBtn');
  if(exportExcelBtn) exportExcelBtn.addEventListener('click', ()=> ASC.table.exportExcel());

  /* ---------- column chooser ---------- */
  const columnChooserBtn = document.getElementById('columnChooserBtn');
  if(columnChooserBtn) columnChooserBtn.addEventListener('click', ()=> ASC.columns.openChooser());
  const colChooserClose = document.getElementById('colChooserClose');
  if(colChooserClose) colChooserClose.addEventListener('click', closeModals);
  const colChooserReset = document.getElementById('colChooserReset');
  if(colChooserReset) colChooserReset.addEventListener('click', ()=>{ ASC.columns.resetLayout(); ASC.columns.renderChooser(); ASC.table.render(); });
  const colChooserDone = document.getElementById('colChooserDone');
  if(colChooserDone) colChooserDone.addEventListener('click', closeModals);

  function closeModals(){
    document.querySelectorAll('.modal.show').forEach(m=>m.classList.remove('show'));
    document.getElementById('modalOverlay').classList.remove('show');
  }
  const modalOverlay = document.getElementById('modalOverlay');
  if(modalOverlay) modalOverlay.addEventListener('click', closeModals);

  /* ---------- bulk toolbar ---------- */
  const bulkClearBtn = document.getElementById('bulkClearBtn');
  if(bulkClearBtn) bulkClearBtn.addEventListener('click', ()=> ASC.table.clearSelection());
  document.querySelectorAll('[data-bulk-classify]').forEach(btn=>{
    btn.addEventListener('click', ()=> ASC.table.bulkClassify(btn.dataset.bulkClassify));
  });
  const bulkExportBtn = document.getElementById('bulkExportBtn');
  if(bulkExportBtn) bulkExportBtn.addEventListener('click', ()=> ASC.table.bulkExport());
  const bulkPrintBtn = document.getElementById('bulkPrintBtn');
  if(bulkPrintBtn) bulkPrintBtn.addEventListener('click', ()=> ASC.table.bulkPrint());
  const bulkDeleteNotesBtn = document.getElementById('bulkDeleteNotesBtn');
  if(bulkDeleteNotesBtn) bulkDeleteNotesBtn.addEventListener('click', ()=>{
    if(confirm('Clear all notes and valuations for the selected lots?')) ASC.table.bulkDeleteNotes();
  });

  /* ---------- topbar: global search, notifications, profile ---------- */
  const globalSearch = document.getElementById('globalSearchInput');
  if(globalSearch) globalSearch.addEventListener('keydown', e=>{
    if(e.key==='Enter' && globalSearch.value.trim()){
      ASC.router.go('catalogue');
      const si = document.getElementById('searchInput');
      if(si){ si.value = globalSearch.value; s.filters.search = globalSearch.value; s.filters.page = 1; ASC.table.render(); }
    }
  });

  function setupDropdown(btnId, panelId){
    const btn = document.getElementById(btnId), panel = document.getElementById(panelId);
    if(!btn || !panel) return;
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      document.querySelectorAll('.dropdown-panel.show').forEach(p=>{ if(p!==panel) p.classList.remove('show'); });
      panel.classList.toggle('show');
    });
    document.addEventListener('click', (e)=>{ if(!panel.contains(e.target) && e.target!==btn) panel.classList.remove('show'); });
  }
  setupDropdown('notifBtn', 'notifPanel');
  setupDropdown('profileBtn', 'profilePanel');
  setupDropdown('exportMenuBtn', 'exportMenuPanel');
  document.querySelectorAll('#exportMenuPanel .dd-item').forEach(el=> el.addEventListener('click', ()=> document.getElementById('exportMenuPanel').classList.remove('show')));

  function renderNotifications(){
    const panel = document.getElementById('notifList');
    const dot = document.querySelector('#notifBtn .dot');
    if(!panel) return;
    if(!ASC.store.hasDataset()){ panel.innerHTML = `<div class="dd-empty">Import a catalogue to start seeing activity here.</div>`; if(dot) dot.classList.remove('show'); return; }
    const entries = Object.entries(s.remarks).filter(([k,r])=>r.updatedAt).sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,6);
    if(entries.length===0){ panel.innerHTML = `<div class="dd-empty">No notifications yet — save a ticket to see it here.</div>`; if(dot) dot.classList.remove('show'); return; }
    if(dot) dot.classList.toggle('show', Date.now() - entries[0][1].updatedAt < 5*60*1000);
    panel.innerHTML = entries.map(([k,r])=>`<div class="dd-item">
      <div class="dd-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg></div>
      <div><div class="dd-title">Ticket saved</div><div class="dd-sub">${ASC.utils.timeAgo(r.updatedAt)}${r.classification ? ' · '+r.classification : ''}</div></div>
    </div>`).join('');
  }
  ASC.notifications = { render: renderNotifications };

  /* ---------- keyboard shortcuts ---------- */
  document.addEventListener('keydown', e=>{
    const tag = (e.target.tagName||'').toLowerCase();
    const typing = tag==='input' || tag==='textarea' || e.target.isContentEditable;
    if(e.key==='/' && !typing){ e.preventDefault(); const gs=document.getElementById('globalSearchInput'); if(gs) gs.focus(); }
    if(e.key.toLowerCase()==='d' && (e.ctrlKey||e.metaKey)===false && !typing) { /* reserved */ }
  });

  /* ---------- init ---------- */
  ASC.theme.init();
  ASC.router.bindNav();
  ASC.drawer.bindEvents();
  ASC.voice.setup();
  if(ASC.market) ASC.market.bindImport();
  ASC.router.go('dashboard');
  renderNotifications();

  window.addEventListener('storage', ()=>{}); // reserved for future multi-tab sync
})();
