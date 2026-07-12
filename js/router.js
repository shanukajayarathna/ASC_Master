/* ===================================================================
   ASC.router — sidebar navigation / page switching (client-side SPA).
   =================================================================== */
window.ASC = window.ASC || {};

ASC.router = (function(){
  const PAGE_TITLES = {
    dashboard: 'Executive Dashboard',
    catalogue: 'Catalogue Manager',
    valuation: 'Valuation Centre',
    analysis: 'Analysis',
    reports: 'Reports',
    broker: 'Broker Comparison',
    market: 'Market Intelligence',
    savedreports: 'Saved Reports',
    savedfilters: 'Saved Filters',
    dataimport: 'Data Import',
    exports: 'Exports',
    settings: 'Settings',
    help: 'Help'
  };

  // Valuation Centre reuses the Catalogue Manager grid (same table/filter engine)
  // pre-scoped to lots that still need attention, rather than duplicating the whole grid.
  const PAGE_ELEMENT_ID = { valuation: 'catalogue' };

  let current = 'dashboard';

  function go(page){
    if(!PAGE_TITLES[page]) return;
    current = page;
    const elementId = PAGE_ELEMENT_ID[page] || page;
    document.querySelectorAll('.page').forEach(p=> p.classList.toggle('active', p.id === 'page-' + elementId));
    document.querySelectorAll('.nav-item').forEach(n=> n.classList.toggle('active', n.dataset.page === page));
    document.getElementById('topbarPageTitle').textContent = PAGE_TITLES[page];
    document.getElementById('sidebar').classList.remove('mobile-open');

    if(page==='dashboard' && ASC.dashboard) ASC.dashboard.render();
    if((page==='catalogue' || page==='valuation') && ASC.store.hasDataset()) ASC.table.render();
    if(page==='valuation') applyPendingValuationPreset();
    if(page==='analysis' && ASC.analysis) ASC.analysis.render();
    if(page==='broker' && ASC.broker) ASC.broker.render();
    if(page==='market' && ASC.market) ASC.market.render();
    if(page==='reports' && ASC.reports) ASC.reports.render();
    if(page==='savedreports' && ASC.savedReports) ASC.savedReports.render();
    if(page==='savedfilters' && ASC.filters) ASC.filters.renderSavedFiltersPage();

    window.scrollTo(0,0);
    const ws = document.querySelector('.workspace'); if(ws) ws.scrollTop = 0;
  }

  function applyPendingValuationPreset(){
    // Valuation Centre defaults to showing lots that still need attention.
    const ss = document.getElementById('statusSelect');
    if(ss && !ASC.store.s.filters.status){
      ASC.store.s.filters.status = 'empty';
      ss.value = 'empty';
      ASC.table.render();
    }
  }

  function bindNav(){
    document.querySelectorAll('.nav-item').forEach(item=>{
      item.addEventListener('click', ()=> go(item.dataset.page));
    });
    document.getElementById('sidebarCollapseBtn').addEventListener('click', ()=>{
      document.getElementById('appShell').classList.toggle('sidebar-collapsed');
    });
    const mobileBtn = document.getElementById('mobileMenuBtn');
    if(mobileBtn) mobileBtn.addEventListener('click', ()=> document.getElementById('sidebar').classList.toggle('mobile-open'));
  }

  return { go, bindNav, get current(){ return current; } };
})();
