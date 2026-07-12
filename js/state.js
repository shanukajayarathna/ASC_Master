/* ===================================================================
   ASC.store — single source of truth for the loaded catalogue,
   remarks/valuations, filters, columns and UI state.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.store = (function(){
  const { hashStr } = ASC.utils;

  const s = {
    HEADERS: [],
    RAW: [],
    COL_META: {},
    SOURCE_NAME: '',
    datasetKey: '',

    remarks: {},          // rowKey -> {standardData, adjectiveData, liquorRemarks, valuationFrom, valuationTo, valuationSingle, classification, brokerNotes, privateNotes, musterReport, updatedAt}
    columnLayout: null,   // {order:[...], hidden:[...], frozen:[...], widths:{}}
    filterPresets: [],    // [{id,name,columnFilters,status,search}]
    savedFilterHistory: [],

    filters: {
      search:'',
      columnFilters:{},   // header -> string | {min,max} | Set
      status:'',
      sortKey:null,
      sortDir:1,
      page:1,
      pageSize:50
    },

    selectedRowKeys: new Set(),
    recentImports: [],
    recentlyViewed: [],

    actualPrices: {},     // lotNumber (string) -> actual auction price, imported post-sale
    actualPricesMeta: null, // {fileName, importedAt, matched, unmatched}
    savedReports: [],     // [{id, type, title, createdAt}] — global, not per-dataset

    theme: 'auto'
  };

  const DEFAULT_VISIBLE_PATTERNS = [/lot/i, /grade/i, /garden/i, /valuat/i, /class/i, /remark/i, /updated/i];
  const HIDE_BY_DEFAULT_PATTERNS = [/broker/i, /sale.?no/i, /sale.?year/i, /^year$/i, /mark/i, /invoice/i, /net.?weight/i, /gross.?weight/i, /categ/i, /stored/i, /warehouse/i, /elevat/i, /region/i, /date/i];

  function findHeader(re, exclude){
    return s.HEADERS.find(h => re.test(h) && (!exclude || !exclude.test(h)));
  }

  function rowKeyFor(row){
    const lotCol = findHeader(/lot/i, /selling/i);
    const invCol = findHeader(/invoice/i);
    if(lotCol && invCol) return 'k_' + hashStr(String(row[lotCol]) + '|' + String(row[invCol]));
    if(lotCol) return 'k_' + hashStr(String(row[lotCol]));
    return 'k_' + hashStr(s.HEADERS.map(h=>row[h]).join('|'));
  }

  const REMARK_TEXT_KEYS = ['standardData','adjectiveData','liquorRemarks','musterReport','brokerNotes','privateNotes'];

  function remarkStatus(key){
    const r = s.remarks[key];
    if(!r) return 'empty';
    const hasValuation = (r.valuationSingle!==undefined && r.valuationSingle!=='' && r.valuationSingle!==null) ||
      (r.valuationFrom!==undefined && r.valuationFrom!=='' && r.valuationFrom!==null);
    const filledText = REMARK_TEXT_KEYS.filter(k => r[k]!==undefined && r[k]!==null && String(r[k]).trim()!=='').length;
    const totalFields = REMARK_TEXT_KEYS.length + 1;
    const filled = filledText + (hasValuation?1:0);
    if(filled===0) return 'empty';
    if(filled>=totalFields) return 'full';
    return 'partial';
  }

  function getValuationValue(key){
    const r = s.remarks[key];
    if(!r) return null;
    if(r.valuationSingle!==undefined && r.valuationSingle!=='' && r.valuationSingle!==null) return Number(r.valuationSingle);
    if(r.valuationFrom!=='' && r.valuationFrom!==undefined && r.valuationTo!=='' && r.valuationTo!==undefined && r.valuationFrom!==null && r.valuationTo!==null){
      return (Number(r.valuationFrom) + Number(r.valuationTo)) / 2;
    }
    if(r.valuationFrom!=='' && r.valuationFrom!==undefined && r.valuationFrom!==null) return Number(r.valuationFrom);
    return null;
  }

  function datasetStorageKey(prefix){
    return prefix + '_' + s.datasetKey;
  }

  function persistRemarks(){
    try{ localStorage.setItem(datasetStorageKey('asc_remarks'), JSON.stringify(s.remarks)); }catch(e){}
  }
  function persistColumnLayout(){
    try{ localStorage.setItem(datasetStorageKey('asc_columns'), JSON.stringify(s.columnLayout)); }catch(e){}
  }
  function persistFilterPresets(){
    try{ localStorage.setItem(datasetStorageKey('asc_presets'), JSON.stringify(s.filterPresets)); }catch(e){}
  }
  function persistRecentImports(){
    try{ localStorage.setItem('asc_recent_imports', JSON.stringify(s.recentImports.slice(0,8))); }catch(e){}
  }
  function loadRecentImports(){
    try{ s.recentImports = JSON.parse(localStorage.getItem('asc_recent_imports')||'[]'); }catch(e){ s.recentImports=[]; }
  }
  function persistActualPrices(){
    try{
      localStorage.setItem(datasetStorageKey('asc_actuals'), JSON.stringify(s.actualPrices));
      localStorage.setItem(datasetStorageKey('asc_actuals_meta'), JSON.stringify(s.actualPricesMeta));
    }catch(e){}
  }
  function persistSavedReports(){
    try{ localStorage.setItem('asc_saved_reports', JSON.stringify(s.savedReports)); }catch(e){}
  }
  function loadSavedReports(){
    try{ s.savedReports = JSON.parse(localStorage.getItem('asc_saved_reports')||'[]'); }catch(e){ s.savedReports=[]; }
  }

  function loadDataset(headers, data, sourceName){
    s.HEADERS = headers;
    s.RAW = data;
    s.SOURCE_NAME = sourceName;
    s.datasetKey = hashStr(headers.join('|'));
    s.COL_META = {};
    headers.forEach(h=>{
      const vals = data.map(d=>d[h]).filter(v=>String(v).trim()!=='');
      const numericCount = vals.filter(v => !isNaN(Number(String(v).replace(/,/g,'')))).length;
      const numeric = vals.length>0 && (numericCount/vals.length) > 0.85;
      const uniq = [...new Set(vals.map(v=>String(v)))];
      const categorical = !numeric && uniq.length>0 && uniq.length<=60 && uniq.length < data.length*0.6;
      s.COL_META[h] = {numeric, categorical, options: categorical ? uniq.sort() : [], defaultVisible: DEFAULT_VISIBLE_PATTERNS.some(re=>re.test(h)) && !HIDE_BY_DEFAULT_PATTERNS.some(re=>re.test(h)) };
    });

    // remarks
    s.remarks = {};
    try{ s.remarks = JSON.parse(localStorage.getItem(datasetStorageKey('asc_remarks')) || '{}'); }catch(e){ s.remarks = {}; }

    // column layout
    let savedLayout = null;
    try{ savedLayout = JSON.parse(localStorage.getItem(datasetStorageKey('asc_columns')) || 'null'); }catch(e){}
    if(savedLayout && Array.isArray(savedLayout.order) && savedLayout.order.every(h=>headers.includes(h))){
      s.columnLayout = savedLayout;
    } else {
      s.columnLayout = {
        order: [...headers],
        hidden: headers.filter(h => HIDE_BY_DEFAULT_PATTERNS.some(re=>re.test(h)) && !DEFAULT_VISIBLE_PATTERNS.some(re=>re.test(h))),
        frozen: [],
        widths: {}
      };
    }

    // filter presets
    try{ s.filterPresets = JSON.parse(localStorage.getItem(datasetStorageKey('asc_presets')) || '[]'); }catch(e){ s.filterPresets = []; }

    // actual auction prices (post-sale, for Market Intelligence)
    try{ s.actualPrices = JSON.parse(localStorage.getItem(datasetStorageKey('asc_actuals')) || '{}'); }catch(e){ s.actualPrices = {}; }
    try{ s.actualPricesMeta = JSON.parse(localStorage.getItem(datasetStorageKey('asc_actuals_meta')) || 'null'); }catch(e){ s.actualPricesMeta = null; }

    s.filters = {search:'', columnFilters:{}, status:'', sortKey: findHeader(/lot/i, /selling/i) || headers[0], sortDir:1, page:1, pageSize:50};
    s.selectedRowKeys = new Set();

    // recent import tracking
    loadRecentImports();
    s.recentImports = s.recentImports.filter(r => r.name !== sourceName);
    s.recentImports.unshift({name: sourceName, rows: data.length, columns: headers.length, importedAt: Date.now()});
    persistRecentImports();
  }

  return {
    s, findHeader, rowKeyFor, remarkStatus, getValuationValue, REMARK_TEXT_KEYS,
    persistRemarks, persistColumnLayout, persistFilterPresets, persistRecentImports, loadRecentImports,
    persistActualPrices, persistSavedReports, loadSavedReports,
    loadDataset, hasDataset: () => s.HEADERS.length > 0
  };
})();
