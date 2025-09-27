const S={};

function setSpin(v){
  S.spin.style.display=v?"inline-flex":"none";
  S.btnRandom.disabled=v; S.btnSent.disabled=v; S.btnNouns.disabled=v;
}
function setErr(t){
  if(!t){ S.err.style.display="none"; S.err.textContent=""; return; }
  S.err.style.display="block"; S.err.textContent=t;
}
function mapSentIcon(lbl){
  if(lbl==="positive")return["👍","good","fa-regular fa-face-smile"];
  if(lbl==="negative")return["👎","bad","fa-regular fa-face-frown"];
  if(lbl==="neutral") return["❓","warn","fa-regular fa-face-meh"];
  return["❓","warn","fa-regular fa-face-meh"];
}
function mapNounIcon(lbl){
  if(lbl==="high"||lbl==="many")return["🟢","good"];
  if(lbl==="medium")return["🟡","warn"];
  if(lbl==="low"||lbl==="few")return["🔴","bad"];
  return["—","warn"];
}
function firstLineLower(t){ return (t||"").split(/\r?\n/)[0].toLowerCase().trim(); }
function normalizeResp(raw){
  let s=firstLineLower(raw).replace(/^[^a-zа-яё]+/i,"");
  if(/positive|positif|положит|хорош|good/.test(s))return"positive";
  if(/negative|negatif|отрицат|плох|bad/.test(s))return"negative";
  if(/neutral|нейтр/.test(s))return"neutral";
  return s;
}
function normalizeLevel(raw){
  let s=firstLineLower(raw);
  if(/\b(high|many|>?\s*15|\bmore than 15\b|более\s*15|много)\b/.test(s))return"high";
  if(/\b(medium|6-15|6 to 15|средн|от\s*6\s*до\s*15)\b/.test(s))return"medium";
  if(/\b(low|few|<\s*6|мало|менее\s*6)\b/.test(s))return"low";
  return s;
}

/* ---------------- Inference API with resilient model fallback ----------------
   Primary (as required): tiiuae/falcon-7b-instruct
   Fallbacks (free, commonly available): Qwen/Qwen2.5-1.5B-Instruct, mistralai/Mistral-7B-Instruct-v0.2
   The first model that returns a successful response will be used.
----------------------------------------------------------------------------- */
const MODEL_CANDIDATES=[
  "tiiuae/falcon-7b-instruct",
  "Qwen/Qwen2.5-1.5B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.2"
];
let ACTIVE_MODEL=MODEL_CANDIDATES[0];

function getAuthHeader(){
  let tok=(S.token.value||"").trim().replace(/[\s\r\n\t]+/g,"");
  return tok?("Bearer "+tok):null;
}

async function tryModel(modelId,prompt,text){
  const url=`https://api-inference.huggingface.co/models/${modelId}`;
  const headers=new Headers();
  headers.set("Accept","application/json");
  headers.set("Content-Type","application/json; charset=utf-8");
  headers.set("X-Wait-For-Model","true");
  const auth=getAuthHeader(); if(auth) headers.set("Authorization",auth);
  const r=await fetch(url,{method:"POST",mode:"cors",cache:"no-store",headers,body:JSON.stringify({inputs:prompt+text})});
  if(r.status===401) throw new Error("401 Unauthorized: invalid or missing token");
  if(r.status===402) throw new Error("402 Payment required / gated model");
  if(r.status===429) throw new Error("429 Rate limited");
  if(r.status===404||r.status===403) return {ok:false,soft:true,detail:r.status}; // try next model
  if(!r.ok){ let e=await r.text(); throw new Error("API error "+r.status+": "+e.slice(0,200)); }
  const data=await r.json();
  let txt=Array.isArray(data)&&data.length&&data[0].generated_text?data[0].generated_text:(data&&data.generated_text?data.generated_text:(typeof data==="string"?data:JSON.stringify(data)));
  return {ok:true,text:txt};
}

async function callApi(prompt,text){
  let lastErr=null;
  for(const m of MODEL_CANDIDATES){
    try{
      const res=await tryModel(m,prompt,text);
      if(res.ok){ ACTIVE_MODEL=m; return res.text; }
      lastErr=new Error("Model "+m+" unavailable ("+res.detail+"), trying next…");
    }catch(e){ lastErr=e; if(String(e.message).startsWith("401")) throw e; }
  }
  throw lastErr||new Error("All models unavailable");
}

/* ---------------- Local sentiment scoring (spec) ---------------- */
function rand(){
  if(!S.reviews.length){ setErr("No reviews loaded."); return; }
  const i=Math.floor(Math.random()*S.reviews.length);
  S.textEl.textContent=S.reviews[i].text||"";
  S.sent.querySelector("span").textContent="Sentiment: —";
  S.sent.className="pill";
  S.sent.querySelector("i").className="fa-regular fa-face-meh";
  S.nouns.querySelector("span").textContent="Noun level: —";
  S.nouns.className="pill";
  setErr("");
}
function stripNoise(t){
  return (t||"")
    .replace(/https?:\/\/\S+/g," ")
    .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g," ")
    .replace(/(^| )@\w+/g," ")
    .replace(/[^\S\r\n]+/g," ")
    .trim();
}
function toTokens(t){
  const x=stripNoise(t).toLowerCase();
  const m=x.match(/([\p{L}\p{M}]+|[.,;:!?])/gu)||[];
  return m;
}
function lemma(tok){
  if(!tok)return tok;
  let t=tok.toLowerCase();
  t=t.replace(/'s$/,"");
  t=t.replace(/(ing|ed|ers|er|ies|s)$/,"");
  t=t.replace(/(ами|ями|ов|ев|ом|ем|ам|ям|ах|ях|ую|юю|ое|ее|ая|яя|ий|ый|ой|ые|ие|ого|его|ему|ому|ими|ыми|ую|юю|ей|ьи|ью|ям|ах|tion|ment)$/,"");
  return t;
}
const POS_LEX={
  pos:new Set(["good","great","excellent","love","like","wonderful","refreshing","delicious","easy","better","best","recommend","loved","amazing","perfect","удобн","хорош","отличн","любл","нрав","прекрасн","классн","супер","рекоменд"]),
  neg:new Set(["bad","worse","worst","awful","terrible","greasy","gross","harsh","notgood","hate","dislike","problem","issues","poor","tastes","smells","плох","хуже","ужасн","мерзк","жирн","проблем","неприятн","плохой","отврат"])
};
const NEGATORS=new Set(["не","нет","no","not","never"]);
const BOOST=new Set(["very","очень"]);
const MITI=new Set(["slightly","немного","чуть"]);
function sentimentLocal(t){
  const toks=toTokens(t).map(lemma);
  let score=0,count=0;
  let ex=(t.match(/!/g)||[]).length;
  let exMul=1+0.1*Math.min(3,ex);
  for(let i=0;i<toks.length;i++){
    let w=0; const tk=toks[i];
    if(POS_LEX.pos.has(tk))w=1; else if(POS_LEX.neg.has(tk))w=-1; else w=0;
    if(w!==0){
      let j=i-1, inv=false, mul=1;
      for(let k=1;k<=3&&j>=0;k++,j--){
        const p=toks[j];
        if(NEGATORS.has(p)){inv=true;break}
        if(/[.,;:!?]/.test(p))break
      }
      if(toks[i-1]&&BOOST.has(toks[i-1]))mul*=1.5;
      if(toks[i-1]&&MITI.has(toks[i-1]))mul*=0.6;
      if(inv)w*=-1;
      w*=mul*exMul;
      score+=w; count++;
    }
  }
  const denom=Math.max(1,Math.sqrt(count));
  let s=Math.max(-4,Math.min(4,score/denom));
  const icon=s>=0?"👍":"👎";
  const confidence=Math.min(1,Math.abs(s)/2);
  return{icon,confidence};
}

/* ---------------- TSV loading ---------------- */
function fetchTSV(url){
  return new Promise((res,rej)=>{
    if(typeof Papa==="undefined"){ rej(new Error("Papa Parse not loaded")); return; }
    Papa.parse(url,{
      download:true, delimiter:"\t", header:true, skipEmptyLines:true,
      complete:r=>{ const rows=(r.data||[]).filter(x=>x&&x.text); res(rows); },
      error:e=>rej(e)
    });
  });
}
async function loadTSV(){
  const candidates=["./reviews_test.tsv","./reviews_test (1).tsv","./reviews_test%20(1).tsv"];
  for(const c of candidates){
    try{ const rows=await fetchTSV(c); if(rows.length) return rows; }catch(_){}
  }
  throw new Error("TSV not found");
}

/* ---------------- Handlers ---------------- */
async function onSent(){
  const txt=S.textEl.textContent.trim();
  if(!txt){ setErr("Select a review first."); return; }
  setErr(""); setSpin(true);
  try{
    const out=await callApi("Classify this review as positive, negative, or neutral: ",txt);
    const lbl=normalizeResp(out);
    const [ico,cls,face]=mapSentIcon(lbl);
    const local=sentimentLocal(txt);
    S.sent.querySelector("span").textContent="Sentiment: "+ico;
    S.sent.className="pill "+cls;
    S.sent.querySelector("i").className=face;
    S.sent.title="model: "+ACTIVE_MODEL+" | local:"+local.icon+" "+Math.round(local.confidence*100)+"%";
  }catch(e){ setErr(e.message); } finally{ setSpin(false); }
}
async function onNouns(){
  const txt=S.textEl.textContent.trim();
  if(!txt){ setErr("Select a review first."); return; }
  setErr(""); setSpin(true);
  try{
    const out=await callApi("Count the nouns in this review and return only High (>15), Medium (6-15), or Low (<6). ",txt);
    let s=normalizeLevel(out);
    if(/many|high/.test(s))s="high"; else if(/medium/.test(s))s="medium"; else if(/few|low/.test(s))s="low";
    const [ico,cls]=mapNounIcon(s);
    S.nouns.querySelector("span").textContent="Noun level: "+ico;
    S.nouns.className="pill "+cls;
  }catch(e){ setErr(e.message); } finally{ setSpin(false); }
}

/* ---------------- Init ---------------- */
function init(){
  S.reviews=[];
  S.textEl=document.getElementById("text");
  S.err=document.getElementById("err");
  S.spin=document.getElementById("spin");
  S.btnRandom=document.getElementById("btnRandom");
  S.btnSent=document.getElementById("btnSent");
  S.btnNouns=document.getElementById("btnNouns");
  S.token=document.getElementById("token");
  S.sent=document.getElementById("sent");
  S.nouns=document.getElementById("nouns");

  S.btnRandom.addEventListener("click",rand);
  S.btnSent.addEventListener("click",onSent);
  S.btnNouns.addEventListener("click",onNouns);

  (async()=>{ try{ S.reviews=await loadTSV(); rand(); } catch(e){ setErr("Failed to load TSV: "+e.message); } })();
}
if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",init); } else { init(); }
