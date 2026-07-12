/* ===================================================================
   ASC.columns — Column Chooser: show/hide, reorder, freeze, resize,
   save layouts. Operates on ASC.store.s.columnLayout.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.columns = (function(){
  const { s, persistColumnLayout } = ASC.store;
  const { escapeHtml } = ASC.utils;

  function visibleHeaders(){
    if(!s.columnLayout) return s.HEADERS;
    return s.columnLayout.order.filter(h => !s.columnLayout.hidden.includes(h) && s.HEADERS.includes(h));
  }

  function isFrozen(h){ return s.columnLayout && s.columnLayout.frozen.includes(h); }

  function toggleVisible(h, visible){
    const hidden = s.columnLayout.hidden;
    const idx = hidden.indexOf(h);
    if(visible && idx>-1) hidden.splice(idx,1);
    if(!visible && idx===-1) hidden.push(h);
    persistColumnLayout();
  }

  function toggleFrozen(h){
    const frozen = s.columnLayout.frozen;
    const idx = frozen.indexOf(h);
    if(idx>-1) frozen.splice(idx,1); else frozen.push(h);
    persistColumnLayout();
  }

  function reorder(fromH, toH){
    const order = s.columnLayout.order;
    const fromIdx = order.indexOf(fromH);
    const toIdx = order.indexOf(toH);
    if(fromIdx===-1 || toIdx===-1) return;
    order.splice(fromIdx,1);
    order.splice(toIdx,0,fromH);
    persistColumnLayout();
  }

  function setWidth(h, px){
    s.columnLayout.widths[h] = px;
    persistColumnLayout();
  }

  function resetLayout(){
    s.columnLayout = {
      order: [...s.HEADERS],
      hidden: s.HEADERS.filter(h => s.COL_META[h] && !s.COL_META[h].defaultVisible),
      frozen: [],
      widths: {}
    };
    persistColumnLayout();
  }

  let dragged = null;

  function renderChooser(){
    const list = document.getElementById('colChooserList');
    if(!list) return;
    list.innerHTML = s.columnLayout.order.map(h=>{
      const hidden = s.columnLayout.hidden.includes(h);
      const frozen = isFrozen(h);
      return `<div class="cc-row" draggable="true" data-h="${escapeHtml(h)}">
        <span class="cc-handle">⠿</span>
        <input type="checkbox" data-role="vis" data-h="${escapeHtml(h)}" ${hidden?'':'checked'}>
        <span class="cc-name">${escapeHtml(h)}</span>
        <button type="button" class="cc-freeze-btn ${frozen?'active':''}" data-role="freeze" data-h="${escapeHtml(h)}">${frozen?'Frozen':'Freeze'}</button>
      </div>`;
    }).join('');

    list.querySelectorAll('input[data-role="vis"]').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        toggleVisible(cb.dataset.h, cb.checked);
        ASC.table.render();
      });
    });
    list.querySelectorAll('button[data-role="freeze"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        toggleFrozen(btn.dataset.h);
        renderChooser();
        ASC.table.render();
      });
    });
    list.querySelectorAll('.cc-row').forEach(row=>{
      row.addEventListener('dragstart', ()=>{ dragged = row.dataset.h; row.classList.add('dragging'); });
      row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); });
      row.addEventListener('dragover', e=> e.preventDefault());
      row.addEventListener('drop', e=>{
        e.preventDefault();
        if(dragged && dragged!==row.dataset.h){
          reorder(dragged, row.dataset.h);
          renderChooser();
          ASC.table.render();
        }
      });
    });
  }

  function openChooser(){
    renderChooser();
    document.getElementById('colChooserModal').classList.add('show');
    document.getElementById('modalOverlay').classList.add('show');
  }
  function closeChooser(){
    document.getElementById('colChooserModal').classList.remove('show');
    document.getElementById('modalOverlay').classList.remove('show');
  }

  function attachResize(th, header){
    const grip = document.createElement('span');
    grip.className = 'col-resize-grip';
    grip.style.cssText = 'position:absolute; right:0; top:0; bottom:0; width:6px; cursor:col-resize; user-select:none;';
    th.appendChild(grip);
    let startX, startW;
    grip.addEventListener('mousedown', e=>{
      e.preventDefault(); e.stopPropagation();
      startX = e.clientX; startW = th.offsetWidth;
      function onMove(ev){
        const w = Math.max(60, startW + (ev.clientX - startX));
        th.style.width = w + 'px';
      }
      function onUp(){
        setWidth(header, th.offsetWidth);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  return { visibleHeaders, isFrozen, toggleVisible, toggleFrozen, reorder, setWidth, resetLayout, openChooser, closeChooser, renderChooser, attachResize };
})();
