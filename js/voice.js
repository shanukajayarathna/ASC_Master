/* ===================================================================
   ASC.voice — voice dictation for ticket text fields.
   =================================================================== */
window.ASC = window.ASC || {};

ASC.voice = (function(){
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, activeMicBtn = null, activeTargetField = null;

  function stop(){
    if(recognition){ try{ recognition.stop(); }catch(e){} }
    if(activeMicBtn) activeMicBtn.classList.remove('recording');
    activeMicBtn = null; activeTargetField = null;
  }

  function setup(){
    if(!SpeechRecognitionAPI){
      document.querySelectorAll('.mic-btn').forEach(b=>{ b.disabled=true; b.title='Voice dictation not supported in this browser'; });
      const hint = document.getElementById('voiceHint');
      if(hint) hint.textContent = "Voice dictation isn't supported in this browser — try Chrome or Edge.";
      return;
    }
    recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e)=>{
      let transcript='';
      for(let i=e.resultIndex;i<e.results.length;i++){ if(e.results[i].isFinal) transcript += e.results[i][0].transcript; }
      if(transcript.trim() && activeTargetField){
        const field = document.getElementById(activeTargetField);
        const sep = field.value.trim() ? ' ' : '';
        field.value = (field.value.trim() + sep + transcript.trim()).trim();
        field.dispatchEvent(new Event('input', {bubbles:true}));
      }
    };
    recognition.onerror = ()=> stop();
    recognition.onend = ()=>{ if(activeMicBtn) activeMicBtn.classList.remove('recording'); };
    document.querySelectorAll('.mic-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const target = btn.dataset.target;
        if(activeMicBtn===btn){ stop(); return; }
        stop();
        activeMicBtn = btn; activeTargetField = target;
        btn.classList.add('recording');
        try{ recognition.start(); }catch(e){}
      });
    });
  }

  return { setup, stop };
})();
