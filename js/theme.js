/* ===================================================================
   ASC.theme — light / dark mode toggle with persistence.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.theme = (function(){
  const STORAGE_KEY = 'asc_theme';

  function apply(theme){
    if(theme==='light' || theme==='dark'){
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    updateToggleIcon(theme);
  }

  function current(){
    return localStorage.getItem(STORAGE_KEY) || 'auto';
  }

  function set(theme){
    localStorage.setItem(STORAGE_KEY, theme);
    apply(theme);
  }

  function toggle(){
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effectiveIsDark = current()==='dark' || (current()==='auto' && systemDark);
    set(effectiveIsDark ? 'light' : 'dark');
  }

  function updateToggleIcon(theme){
    const btn = document.getElementById('themeToggleBtn');
    if(!btn) return;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme==='dark' || (theme==='auto' && systemDark);
    btn.innerHTML = isDark
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>';
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  function init(){
    apply(current());
    const btn = document.getElementById('themeToggleBtn');
    if(btn) btn.addEventListener('click', toggle);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{ if(current()==='auto') apply('auto'); });
  }

  return { init, set, toggle, current };
})();
