/* ===================================================================
   ASC.savedReports — Saved Reports page: list, reopen, delete.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.savedReports = (function(){
  const { s } = ASC.store;
  const { escapeHtml, timeAgo } = ASC.utils;

  function render(){
    ASC.store.loadSavedReports();
    const empty = document.getElementById('savedReportsEmpty');
    const list = document.getElementById('savedReportsList');
    if(!list) return;
    if(s.savedReports.length===0){
      if(empty) empty.style.display = 'block';
      list.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    list.style.display = 'block';
    list.innerHTML = s.savedReports.map(r=>`<div class="recent-import-item">
      <span class="name">${escapeHtml(r.title)}</span>
      <span style="color:var(--text-muted); font-size:11.5px;">${escapeHtml(r.source||'')}</span>
      <span class="meta">${timeAgo(r.createdAt)}</span>
      <button class="btn ghost small" data-open="${r.id}">Open</button>
      <button class="btn ghost small" data-del="${r.id}">Delete</button>
    </div>`).join('');
    list.querySelectorAll('[data-open]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const rep = s.savedReports.find(r=>r.id===btn.dataset.open);
        if(!rep) return;
        ASC.router.go('reports');
        const sel = document.getElementById('reportTypeSelect');
        if(sel){ sel.value = rep.type; sel.dispatchEvent(new Event('change')); }
      });
    });
    list.querySelectorAll('[data-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        s.savedReports = s.savedReports.filter(r=>r.id!==btn.dataset.del);
        ASC.store.persistSavedReports();
        render();
      });
    });
  }

  return { render };
})();
