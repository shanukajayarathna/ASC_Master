/* ===================================================================
   ASC.utils — shared helpers used across every module
   =================================================================== */
window.ASC = window.ASC || {};

ASC.utils = (function(){

  function escapeHtml(v){
    if(v===undefined || v===null) return '';
    return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function hashStr(s){
    let h=0;
    for(let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))|0; }
    return (h>>>0).toString(36);
  }

  function toNumber(v){
    if(v===undefined || v===null || v==='') return NaN;
    return Number(String(v).replace(/,/g,''));
  }

  function formatCurrency(n, opts){
    opts = opts || {};
    if(n===undefined || n===null || isNaN(n)) return '—';
    return 'Rs. ' + Number(n).toLocaleString(undefined, {minimumFractionDigits:opts.decimals!==undefined?opts.decimals:2, maximumFractionDigits:opts.decimals!==undefined?opts.decimals:2});
  }

  function formatNumber(n, decimals){
    if(n===undefined || n===null || isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, {minimumFractionDigits:decimals||0, maximumFractionDigits:decimals||2});
  }

  function debounce(fn, wait){
    let t;
    return function(...args){
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(this,args), wait);
    };
  }

  function mean(arr){
    const nums = arr.filter(n=>!isNaN(n));
    if(!nums.length) return NaN;
    return nums.reduce((s,n)=>s+n,0) / nums.length;
  }
  function median(arr){
    const nums = arr.filter(n=>!isNaN(n)).sort((a,b)=>a-b);
    if(!nums.length) return NaN;
    const mid = Math.floor(nums.length/2);
    return nums.length%2 ? nums[mid] : (nums[mid-1]+nums[mid])/2;
  }
  function mode(arr){
    const counts = {};
    let best=null, bestCount=0;
    arr.forEach(v=>{
      if(v===undefined || v===null || v==='') return;
      const k = String(v);
      counts[k] = (counts[k]||0)+1;
      if(counts[k]>bestCount){ bestCount=counts[k]; best=k; }
    });
    return best;
  }
  function stddev(arr){
    const nums = arr.filter(n=>!isNaN(n));
    if(nums.length<2) return NaN;
    const m = mean(nums);
    const variance = nums.reduce((s,n)=>s+(n-m)*(n-m),0) / nums.length;
    return Math.sqrt(variance);
  }
  function variance(arr){
    const s = stddev(arr);
    return isNaN(s) ? NaN : s*s;
  }
  function quartiles(arr){
    const nums = arr.filter(n=>!isNaN(n)).sort((a,b)=>a-b);
    if(!nums.length) return {q1:NaN,q2:NaN,q3:NaN};
    const q = p => {
      const idx = (nums.length-1)*p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return nums[lo] + (nums[hi]-nums[lo]) * (idx-lo);
    };
    return {q1:q(0.25), q2:q(0.5), q3:q(0.75)};
  }

  function uid(prefix){
    return (prefix||'id') + '_' + Math.random().toString(36).slice(2,9);
  }

  function timeAgo(ts){
    if(!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff/60000);
    if(m<1) return 'just now';
    if(m<60) return m + 'm ago';
    const h = Math.floor(m/60);
    if(h<24) return h + 'h ago';
    const d = Math.floor(h/24);
    if(d<7) return d + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  let toastTimer = null;
  function showToast(msg, opts){
    opts = opts || {};
    const t = document.getElementById('toast');
    if(!t) return;
    t.textContent = (opts.icon || '✓') + '  ' + msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>t.classList.remove('show'), opts.duration || 2600);
  }

  function downloadBlob(content, filename, type){
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvEscape(v){
    return `"${String(v===undefined||v===null?'':v).replace(/"/g,'""')}"`;
  }

  return {
    escapeHtml, hashStr, toNumber, formatCurrency, formatNumber, debounce,
    mean, median, mode, stddev, variance, quartiles,
    uid, timeAgo, showToast, downloadBlob, csvEscape
  };
})();
