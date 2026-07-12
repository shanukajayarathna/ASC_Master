/* ===================================================================
   ASC.market — Market Intelligence: import actual auction results,
   compare against estimated valuations, accuracy scoring, insights.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.market = (function(){
  const { s, findHeader, rowKeyFor, getValuationValue } = ASC.store;
  const { escapeHtml, formatCurrency, formatNumber, mean, showToast } = ASC.utils;

  function idColumn(){ return findHeader(/lot/i, /selling/i); }

  function importActuals(file){
    return ASC.parsing.parseFile(file).then(res=>{
      const lotCol = res.headers.find(h=>/lot/i.test(h) && !/selling/i.test(h)) || res.headers[0];
      const priceCol = res.headers.find(h=>/actual|sold|final|hammer|price/i.test(h)) ||
        res.headers.find(h=>{
          const vals = res.data.map(d=>d[h]).filter(v=>String(v).trim()!=='');
          return vals.length && vals.every(v=>!isNaN(Number(String(v).replace(/,/g,''))));
        });
      if(!lotCol || !priceCol){
        throw new Error('Could not find a lot number and a price column in that file.');
      }
      const map = {};
      res.data.forEach(row=>{
        const lot = String(row[lotCol]||'').trim();
        const price = Number(String(row[priceCol]||'').replace(/,/g,''));
        if(lot && !isNaN(price)) map[lot] = price;
      });

      const idCol = idColumn();
      let matched = 0, unmatched = 0;
      if(idCol){
        s.RAW.forEach(row=>{
          const lot = String(row[idCol]||'').trim();
          if(map[lot]!==undefined) matched++; else unmatched++;
        });
      }
      s.actualPrices = map;
      s.actualPricesMeta = {fileName: res.fileName, importedAt: Date.now(), matched, unmatched, lotColumn: lotCol, priceColumn: priceCol};
      ASC.store.persistActualPrices();
      return s.actualPricesMeta;
    });
  }

  function matchedPairs(){
    const idCol = idColumn();
    if(!idCol) return [];
    return s.RAW.map(row=>{
      const key = rowKeyFor(row);
      const est = getValuationValue(key);
      const lot = String(row[idCol]||'').trim();
      const actual = s.actualPrices[lot];
      if(est===null || actual===undefined || isNaN(actual)) return null;
      return {row, key, est, actual, diff: actual-est, pctError: est!==0 ? (actual-est)/est*100 : 0};
    }).filter(Boolean);
  }

  function render(){
    const empty = document.getElementById('marketEmpty');
    const content = document.getElementById('marketContent');
    if(!ASC.store.hasDataset()){
      if(empty) empty.style.display = 'block';
      if(content) content.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    if(content) content.style.display = 'block';

    const metaEl = document.getElementById('marketImportMeta');
    if(metaEl){
      metaEl.textContent = s.actualPricesMeta
        ? `Actuals loaded from ${s.actualPricesMeta.fileName} · ${s.actualPricesMeta.matched} lots matched, ${s.actualPricesMeta.unmatched} lots in catalogue without an actual price`
        : 'No actual auction results imported yet for this catalogue.';
    }

    const pairs = matchedPairs();
    const resultsWrap = document.getElementById('marketResults');
    const noPairs = document.getElementById('marketNoPairs');
    if(!pairs.length){
      if(resultsWrap) resultsWrap.style.display = 'none';
      if(noPairs) noPairs.style.display = 'block';
      return;
    }
    if(resultsWrap) resultsWrap.style.display = 'block';
    if(noPairs) noPairs.style.display = 'none';

    renderAccuracyOverview(pairs);
    renderAccuracyBy(pairs, 'broker', /broker/i);
    renderAccuracyBy(pairs, 'grade', /grade/i);
    renderAccuracyBy(pairs, 'elevation', /elevat/i);
    renderInsights(pairs);
  }

  function renderAccuracyOverview(pairs){
    const wrap = document.getElementById('marketOverview');
    if(!wrap) return;
    const errors = pairs.map(p=>p.diff);
    const pctErrors = pairs.map(p=>p.pctError);
    const absPct = pctErrors.map(Math.abs);
    const rmse = Math.sqrt(mean(errors.map(e=>e*e)));
    const mape = mean(absPct);
    const accuracy = 100 - mape;
    const totalGain = errors.filter(e=>e>0).reduce((a,b)=>a+b,0);
    const totalLoss = errors.filter(e=>e<0).reduce((a,b)=>a+b,0);

    const tiles = [
      ['Lots Compared', pairs.length.toLocaleString()],
      ['Average Accuracy', formatNumber(accuracy,1)+'%'],
      ['MAPE', formatNumber(mape,2)+'%'],
      ['RMSE', formatCurrency(rmse,{decimals:2})],
      ['Average Error', formatCurrency(mean(errors),{decimals:2})],
      ['Total Gain (undervalued lots)', formatCurrency(totalGain,{decimals:2})],
      ['Total Loss (overvalued lots)', formatCurrency(totalLoss,{decimals:2})]
    ];
    wrap.innerHTML = tiles.map(([lbl,num])=>`<div class="kpi-tile"><div class="kpi-num">${num}</div><div class="kpi-lbl">${lbl}</div></div>`).join('');
  }

  function renderAccuracyBy(pairs, key, re){
    const wrap = document.getElementById('marketAccuracy_'+key);
    if(!wrap) return;
    const col = findHeader(re);
    if(!col){ wrap.innerHTML = `<p style="color:var(--text-muted); font-size:12.5px;">No matching column detected.</p>`; return; }
    const buckets = {};
    pairs.forEach(p=>{
      const k = String(p.row[col]||'').trim() || '(blank)';
      (buckets[k] = buckets[k]||[]).push(p.pctError);
    });
    const rows = Object.entries(buckets).map(([k,arr])=>({label:k, mape: mean(arr.map(Math.abs)), bias: mean(arr), n: arr.length}))
      .sort((a,b)=>a.mape-b.mape);
    const max = rows.length ? Math.max(...rows.map(r=>r.mape)) : 1;
    wrap.innerHTML = rows.slice(0,12).map(r=>`<div class="bar-row">
      <div class="bar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
      <div class="bar-track"><div class="bar-fill ${r.mape>15?'danger':''}" style="width:${max?r.mape/max*100:0}%"></div></div>
      <div class="bar-val">${formatNumber(r.mape,1)}% err <span style="opacity:.6;">(${r.n})</span></div>
    </div>`).join('');
  }

  function renderInsights(pairs){
    const wrap = document.getElementById('marketInsights');
    if(!wrap) return;
    const insights = [];
    [{key:'grade', re:/grade/i, label:'Grade'}, {key:'elevation', re:/elevat/i, label:'Elevation'}, {key:'broker', re:/broker/i, label:'Broker'}]
      .forEach(({re,label})=>{
        const col = findHeader(re);
        if(!col) return;
        const buckets = {};
        pairs.forEach(p=>{
          const k = String(p.row[col]||'').trim();
          if(!k) return;
          (buckets[k] = buckets[k]||[]).push(p.diff);
        });
        Object.entries(buckets).forEach(([k,diffs])=>{
          if(diffs.length < 3) return;
          const avgDiff = mean(diffs);
          if(Math.abs(avgDiff) < 1) return;
          insights.push({
            magnitude: Math.abs(avgDiff),
            text: `${label} <strong>${escapeHtml(k)}</strong> lots (${diffs.length} matched) are consistently <strong>${avgDiff<0?'overvalued':'undervalued'}</strong> by approximately ${formatCurrency(Math.abs(avgDiff),{decimals:2})} per lot.`
          });
        });
      });
    insights.sort((a,b)=>b.magnitude-a.magnitude);
    if(insights.length===0){
      wrap.innerHTML = `<p style="color:var(--text-muted); font-size:12.5px;">No strong valuation patterns detected yet — import more matched actuals for sharper insights.</p>`;
      return;
    }
    wrap.innerHTML = insights.slice(0,6).map(i=>`<div class="cs-feature"><span class="dot"></span>${i.text}</div>`).join('');
  }

  function bindImport(){
    const btn = document.getElementById('marketImportBtn');
    const input = document.getElementById('marketImportInput');
    if(!btn || !input) return;
    btn.addEventListener('click', ()=> input.click());
    input.addEventListener('change', e=>{
      const f = e.target.files[0];
      if(!f) return;
      importActuals(f).then(meta=>{
        showToast(`Matched ${meta.matched} lots against actual results`);
        render();
      }).catch(err=>{
        showToast(err.message, {icon:'⚠'});
      });
      input.value = '';
    });
  }

  return { render, bindImport, importActuals };
})();
