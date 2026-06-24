// Simultaneous MT Frontend
let state = { srcLang:'te', tgtLang:'en', k:3, languages:[], examples:{}, isTranslating:false };

document.addEventListener('DOMContentLoaded', async()=>{
    await loadLanguages(); await loadExamples();
    document.getElementById('k-slider').addEventListener('input', e=>{
        state.k=parseInt(e.target.value);
        document.getElementById('k-display').textContent=`k=${state.k}`;
    });
    document.getElementById('swap-direction').addEventListener('click',()=>{
        [state.srcLang,state.tgtLang]=[state.tgtLang,state.srcLang];
        renderLanguageSelectors();
    });
});

async function loadLanguages(){
    try{ const r=await fetch('/api/languages'); const d=await r.json(); state.languages=d.languages; }
    catch(e){ state.languages=[{code:'te',name:'Telugu',script:'తెలుగు'},{code:'hi',name:'Hindi',script:'हिन्दी'},{code:'gu',name:'Gujarati',script:'ગુજરાતી'},{code:'ta',name:'Tamil',script:'தமிழ்'},{code:'en',name:'English',script:'English'}]; }
    renderLanguageSelectors();
}

function renderLanguageSelectors(){
    ['src','tgt'].forEach(side=>{
        const c=document.getElementById(`${side}-lang-selector`);
        c.innerHTML='';
        state.languages.forEach(l=>{
            const b=document.createElement('button');
            b.className=`lang-btn ${l.code===(side==='src'?state.srcLang:state.tgtLang)?'active':''}`;
            b.innerHTML=`${l.name} <span class="script">${l.script}</span>`;
            b.onclick=()=>{ if(side==='src'){if(l.code===state.tgtLang)state.tgtLang=state.srcLang;state.srcLang=l.code;}else{if(l.code===state.srcLang)state.srcLang=state.tgtLang;state.tgtLang=l.code;} renderLanguageSelectors(); };
            c.appendChild(b);
        });
    });
    const sl=state.languages.find(l=>l.code===state.srcLang);
    const tl=state.languages.find(l=>l.code===state.tgtLang);
    document.getElementById('input-label').textContent=`Source (${sl?.name||state.srcLang})`;
    document.getElementById('output-label').textContent=`Translation (${tl?.name||state.tgtLang})`;
    renderExamples();
}

async function loadExamples(){
    try{ const r=await fetch('/api/examples'); const d=await r.json(); state.examples=d.examples; }
    catch(e){ state.examples={te:['నేను రోజూ ఉదయం పార్కులో నడుస్తాను.'],hi:['मैं हर रोज सुबह पार्क में टहलता हूँ.'],gu:['હું દરરોજ સવારે પાર્કમાં ચાલું છું.'],ta:['நான் தினமும் காலையில் பூங்காவில் நடப்பேன்.'],en:['I walk in the park every morning.']}; }
    renderExamples();
}

function renderExamples(){
    const bar=document.getElementById('examples-bar'); bar.innerHTML='';
    (state.examples[state.srcLang]||[]).forEach(t=>{
        const c=document.createElement('button'); c.className='example-chip'; c.textContent=t;
        c.onclick=()=>document.getElementById('source-input').value=t;
        bar.appendChild(c);
    });
}

function setStatus(t,type=''){document.getElementById('status-bar').className=`status-bar ${type}`;document.getElementById('status-text').textContent=t;}
function activatePipelineStep(id){document.querySelectorAll('.pipeline-step').forEach(s=>s.classList.remove('active'));if(id)document.getElementById(id)?.classList.add('active');}
function escapeHtml(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}

async function translateFull(){
    const text=document.getElementById('source-input').value.trim();
    if(!text||state.isTranslating)return;
    state.isTranslating=true; setStatus('Translating (full sentence)...','active');
    activatePipelineStep('pipe-source');
    const out=document.getElementById('translation-output');
    out.innerHTML='<span class="loading-shimmer" style="display:inline-block;width:60%;height:1.2em;border-radius:4px">&nbsp;</span>';
    try{
        const r=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target_lang:state.tgtLang})});
        const d=await r.json(); out.textContent=d.translation;
        activatePipelineStep('pipe-target'); setStatus('Done — Full sentence','active');
    }catch(e){out.textContent=`Error: ${e.message}`;setStatus('Error','');}
    state.isTranslating=false;
}

async function translateStream(){
    const text=document.getElementById('source-input').value.trim();
    if(!text||state.isTranslating)return;
    state.isTranslating=true; setStatus(`Translating (wait-${state.k})...`,'streaming');
    const out=document.getElementById('translation-output');
    const trace=document.getElementById('trace-container');
    const stats=document.getElementById('trace-stats');
    out.innerHTML='<span class="cursor-blink"></span>'; trace.innerHTML=''; let rc=0,wc=0;
    try{
        const res=await fetch('/api/translate/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target_lang:state.tgtLang,k:state.k})});
        const reader=res.body.getReader(); const dec=new TextDecoder(); let buf='';
        while(true){
            const{done,value}=await reader.read(); if(done)break;
            buf+=dec.decode(value,{stream:true});
            const parts=buf.split('\n\n'); buf=parts.pop();
            for(const part of parts){
                let ev='message',data='';
                for(const line of part.split('\n')){
                    if(line.startsWith('event:'))ev=line.slice(6).trim();
                    else if(line.startsWith('data:'))data=line.slice(5).trim();
                }
                if(!data)continue;
                try{
                    const d=JSON.parse(data);
                    if(ev==='read'){activatePipelineStep('pipe-read');addTrace(trace,'read',`"${d.word}" (${d.src_read}/${d.src_total})`);rc++;}
                    else if(ev==='write'){activatePipelineStep('pipe-write');out.innerHTML=escapeHtml(d.translation_so_far)+'<span class="cursor-blink"></span>';addTrace(trace,'write',`"${d.token}" → ${d.translation_so_far}`);wc++;}
                    else if(ev==='stop'){activatePipelineStep('pipe-target');addTrace(trace,'stop','End of translation');const c=out.querySelector('.cursor-blink');if(c)c.remove();setStatus(`Done — Wait-${state.k}`,'active');}
                    else if(ev==='done'){activatePipelineStep('pipe-target');out.textContent=d.translation;setStatus(`Done — Wait-${state.k} | ${d.src_words} words → ${d.tgt_tokens} tokens`,'active');}
                    stats.textContent=`READ: ${rc} | WRITE: ${wc}`;
                }catch(e){}
            }
        }
    }catch(e){out.textContent=`Error: ${e.message}`;setStatus('Error','');}
    state.isTranslating=false;
}

function addTrace(c,action,detail){
    const s=document.createElement('div');s.className='trace-step';
    s.innerHTML=`<span class="trace-action ${action}">${action}</span><span class="trace-detail">${escapeHtml(detail)}</span>`;
    c.appendChild(s);c.scrollTop=c.scrollHeight;
}

async function runComparison(){
    const text=document.getElementById('source-input').value.trim();
    if(!text||state.isTranslating)return;
    state.isTranslating=true;
    const fe=document.getElementById('comparison-full');
    const we=document.getElementById('comparison-waitk');
    fe.innerHTML=we.innerHTML='<span class="loading-shimmer" style="display:inline-block;width:80%;height:1.2em;border-radius:4px">&nbsp;</span>';
    const[fr,wr]=await Promise.allSettled([
        fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target_lang:state.tgtLang})}).then(r=>r.json()),
        fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target_lang:state.tgtLang})}).then(r=>r.json()),
    ]);
    if(fr.status==='fulfilled')fe.textContent=fr.value.translation;
    if(wr.status==='fulfilled')we.textContent=wr.value.translation;
    state.isTranslating=false;
}

function clearAll(){
    document.getElementById('source-input').value='';
    document.getElementById('translation-output').innerHTML='<span style="color:var(--text-muted)">Translation will appear here...</span>';
    document.getElementById('trace-container').innerHTML='<div style="color:var(--text-muted);font-style:italic">Trace will appear here...</div>';
    document.getElementById('trace-stats').textContent='';
    setStatus('Ready',''); activatePipelineStep(null);
}
