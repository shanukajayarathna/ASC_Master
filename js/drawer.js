/* ===================================================================
   ASC.drawer — Valuation Centre ticket drawer: range/single valuation,
   classification, notes, voice dictation, validation, autosave.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.drawer = (function(){
  const { s, findHeader, rowKeyFor } = ASC.store;
  const { escapeHtml, showToast } = ASC.utils;

  let currentRowKey = null;
  let autosaveTimer = null;

  function open(key){
    const d = s.RAW.find(r => rowKeyFor(r) === key);
    if(!d) return;
    currentRowKey = key;

    const markCol = findHeader(/^mark$/i) || findHeader(/mark/i, /selling/i);
    const sellingCol = findHeader(/selling.?mark/i);
    const lotCol = findHeader(/lot/i, /selling/i);
    const invCol = findHeader(/invoice/i);

    const title = (markCol && d[markCol]) || (sellingCol && d[sellingCol]) || (s.HEADERS[1] ? d[s.HEADERS[1]] : d[s.HEADERS[0]]) || 'Lot';
    document.getElementById('tTitle').textContent = title;
    const kicker = [lotCol ? ('LOT ' + d[lotCol]) : null, invCol ? ('INV ' + d[invCol]) : null].filter(Boolean).join(' · ') || 'LOT DETAIL';
    document.getElementById('tKicker').textContent = kicker;
    const subtitleCols = s.HEADERS.filter(h => h!==markCol && h!==lotCol && h!==invCol).slice(0,3);
    document.getElementById('tSubtitle').textContent = subtitleCols.map(h=>`${d[h]}`).filter(Boolean).join(' · ');

    document.getElementById('factsGrid').innerHTML = s.HEADERS.map(h=>
      `<div class="fact"><div class="k">${escapeHtml(h)}</div><div class="v">${escapeHtml(d[h]) || '—'}</div></div>`
    ).join('');

    const r = s.remarks[key] || {};
    document.getElementById('fStandardData').value = r.standardData || '';
    document.getElementById('fAdjectiveData').value = r.adjectiveData || '';
    document.getElementById('fLiquorRemarks').value = r.liquorRemarks || '';
    document.getElementById('fValuationFrom').value = r.valuationFrom || '';
    document.getElementById('fValuationTo').value = r.valuationTo || '';
    document.getElementById('fValuationSingle').value = r.valuationSingle || '';
    document.getElementById('fBrokerNotes').value = r.brokerNotes || '';
    document.getElementById('fPrivateNotes').value = r.privateNotes || '';
    document.getElementById('fMusterReport').value = r.musterReport || '';
    setClassification(r.classification || '');
    document.getElementById('tUpdated').textContent = r.updatedAt ? ('Last saved ' + new Date(r.updatedAt).toLocaleString()) : 'Not yet saved';
    validateRange();

    trackRecentlyViewed(key, title);

    document.getElementById('overlay').classList.add('show');
    document.getElementById('drawer').classList.add('show');
  }

  function trackRecentlyViewed(key, title){
    s.recentlyViewed = (s.recentlyViewed||[]).filter(r=>r.key!==key);
    s.recentlyViewed.unshift({key, title, at: Date.now()});
    s.recentlyViewed = s.recentlyViewed.slice(0,10);
  }

  function close(){
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('drawer').classList.remove('show');
    ASC.voice.stop();
    currentRowKey = null;
  }

  function currentClassification(){
    const active = document.querySelector('#drawer .class-chip.active');
    return active ? active.dataset.cls : '';
  }
  function setClassification(cls){
    document.querySelectorAll('#drawer .class-chip').forEach(chip=>{
      chip.classList.toggle('active', chip.dataset.cls===cls);
    });
  }

  function validateRange(){
    const from = document.getElementById('fValuationFrom').value.trim();
    const to = document.getElementById('fValuationTo').value.trim();
    const warn = document.getElementById('rangeWarning');
    if(from!=='' && to!=='' && Number(from) >= Number(to)){
      warn.classList.add('show');
      warn.textContent = '⚠ "From" must be smaller than "To".';
      return false;
    }
    warn.classList.remove('show');
    return true;
  }

  function save(silent){
    if(!currentRowKey) return;
    if(!validateRange()){
      if(!silent) showToast('Fix the valuation range before saving');
      return false;
    }
    s.remarks[currentRowKey] = {
      standardData: document.getElementById('fStandardData').value.trim(),
      adjectiveData: document.getElementById('fAdjectiveData').value.trim(),
      liquorRemarks: document.getElementById('fLiquorRemarks').value.trim(),
      valuationFrom: document.getElementById('fValuationFrom').value.trim(),
      valuationTo: document.getElementById('fValuationTo').value.trim(),
      valuationSingle: document.getElementById('fValuationSingle').value.trim(),
      brokerNotes: document.getElementById('fBrokerNotes').value.trim(),
      privateNotes: document.getElementById('fPrivateNotes').value.trim(),
      musterReport: document.getElementById('fMusterReport').value.trim(),
      classification: currentClassification(),
      updatedAt: Date.now()
    };
    ASC.store.persistRemarks();
    ASC.table.render();
    if(ASC.dashboard) ASC.dashboard.render();
    if(ASC.notifications) ASC.notifications.render();
    if(ASC.analysis && ASC.router && ASC.router.current==='analysis') ASC.analysis.render();
    document.getElementById('tUpdated').textContent = 'Last saved ' + new Date().toLocaleString();
    if(!silent) showToast('Sample ticket saved');
    return true;
  }

  function scheduleAutosave(){
    clearTimeout(autosaveTimer);
    const indicator = document.getElementById('autosaveIndicator');
    if(indicator) indicator.textContent = 'Saving…';
    autosaveTimer = setTimeout(()=>{
      const ok = save(true);
      if(indicator) indicator.textContent = ok ? 'Autosaved' : 'Not saved — fix errors';
    }, 900);
  }

  function bindEvents(){
    document.getElementById('overlay').addEventListener('click', close);
    document.getElementById('closeDrawer').addEventListener('click', close);
    document.getElementById('cancelTicket').addEventListener('click', close);
    document.getElementById('saveTicket').addEventListener('click', ()=> save(false));
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') close(); });

    document.querySelectorAll('#drawer .class-chip').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const isActive = chip.classList.contains('active');
        setClassification(isActive ? '' : chip.dataset.cls);
        scheduleAutosave();
      });
    });

    ['fStandardData','fAdjectiveData','fLiquorRemarks','fValuationFrom','fValuationTo','fValuationSingle','fBrokerNotes','fPrivateNotes','fMusterReport'].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      el.addEventListener('input', ()=>{
        if(id==='fValuationFrom' || id==='fValuationTo') validateRange();
        scheduleAutosave();
      });
    });
  }

  return { open, close, save, bindEvents, get currentRowKey(){ return currentRowKey; } };
})();
