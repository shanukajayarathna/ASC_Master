/* ===================================================================
   ASC.parsing — file import & table extraction (Excel / CSV / ODS).
   Ported from the original single-file app; logic unchanged, only
   namespaced and wired to ASC.store instead of module-level globals.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.parsing = (function(){

  function extractTable(rows){
    // find the first row that looks like a header: mostly non-empty, mostly non-numeric text
    let headerIdx = -1;
    const limit = Math.min(rows.length, 15);
    for(let i=0;i<limit;i++){
      const r = rows[i] || [];
      const nonEmpty = r.filter(c => String(c).trim()!=='');
      if(nonEmpty.length < Math.max(2, Math.ceil(r.length*0.4))) continue;
      const textLike = nonEmpty.filter(c => String(c).trim()!=='' && isNaN(Number(String(c).replace(/,/g,''))));
      if(textLike.length / nonEmpty.length >= 0.6){
        headerIdx = i;
        break;
      }
    }
    if(headerIdx === -1) return null;
    const rawHeaders = rows[headerIdx];
    const seen = {};
    const headers = rawHeaders.map((h,i)=>{
      let name = String(h).trim() || ('Column ' + (i+1));
      if(seen[name] !== undefined){ seen[name]++; name = name + ' (' + seen[name] + ')'; }
      else{ seen[name] = 0; }
      return name;
    });
    const dataRows = rows.slice(headerIdx+1).filter(r => r.some(c => String(c).trim()!==''));
    const data = dataRows.map(r=>{
      const obj = {};
      headers.forEach((h,i)=>{ obj[h] = (r[i]!==undefined && r[i]!==null) ? r[i] : ''; });
      return obj;
    });
    return {headers, data};
  }

  function parseFile(file){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = (e)=>{
        try{
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, {type:'array'});
          const sheetName = wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', raw:false});
          const parsed = extractTable(rows);
          if(!parsed || parsed.data.length===0){
            reject(new Error("Couldn't find a usable table with a header row in this file. Please check the sheet and try again."));
            return;
          }
          resolve({headers:parsed.headers, data:parsed.data, sheetNames:wb.SheetNames, fileName:file.name});
        }catch(err){
          reject(new Error('Something went wrong reading that file: ' + err.message));
        }
      };
      reader.onerror = ()=> reject(new Error('Could not read the file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  // Detect whether two header sets are compatible enough to merge/compare catalogues.
  function headerOverlap(headersA, headersB){
    const setB = new Set(headersB);
    const shared = headersA.filter(h=>setB.has(h));
    return shared.length / Math.max(headersA.length, headersB.length);
  }

  // Merge multiple parsed datasets that share the same header shape.
  function mergeDatasets(parsedList){
    const base = parsedList[0];
    const merged = {headers: base.headers, data: [], fileName: parsedList.map(p=>p.fileName).join(' + ')};
    const seenRowHashes = new Set();
    let duplicates = 0;
    parsedList.forEach(p=>{
      p.data.forEach(row=>{
        const key = base.headers.map(h=>row[h]).join('|');
        if(seenRowHashes.has(key)){ duplicates++; return; }
        seenRowHashes.add(key);
        merged.data.push(row);
      });
    });
    return {merged, duplicates};
  }

  return { extractTable, parseFile, headerOverlap, mergeDatasets };
})();
