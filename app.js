// Глобальное состояние и ссылки на элементы UI
const S={reviews:[],textEl:document.getElementById("text"),err:document.getElementById("err"),spin:document.getElementById("spin"),btnRandom:document.getElementById("btnRandom"),btnSent:document.getElementById("btnSent"),btnNouns:document.getElementById("btnNouns"),token:document.getElementById("token"),sent:document.getElementById("sent"),nouns:document.getElementById("nouns")};

// Показ/скрытие индикатора загрузки и блокировка кнопок
function setSpin(v){S.spin.style.display=v?"inline-flex":"none";S.btnRandom.disabled=v;S.btnSent.disabled=v;S.btnNouns.disabled=v}

// Показ/скрытие блока ошибок
function setErr(t){if(!t){S.err.style.display="none";S.err.textContent="";return}S.err.style.display="block";S.err.textContent=t}

// Сопоставление текстовой метки сентимента с иконкой и стилем
function mapSentIcon(lbl){if(lbl==="positive")return["👍","good","fa-regular fa-face-smile"];if(lbl==="negative")return["👎","bad","fa-regular fa-face-frown"];if(lbl==="neutral")return["❓","warn","fa-regular fa-face-meh"];return["❓","warn","fa-regular fa-face-meh"]}

// Сопоставление уровня существительных с иконкой и стилем
function mapNounIcon(lbl){if(lbl==="high"||lbl==="many")return["🟢","good"];if(lbl==="medium")return["🟡","warn"];if(lbl==="low"||lbl==="few")return["🔴","bad"];return["—","warn"]}

// Взять первую строку ответа и привести к нижнему регистру
function firstLineLower(t){return (t||"").split(/\r?\n/)[0].toLowerCase().trim()}

// Нормализация ответа модели по сентименту к one-of: positive/negative/neutral
function normalizeResp(raw){let s=firstLineLower(raw).replace(/^[^a-zа-яё]+/i,"");if(/positive|positif|положит|хорош|good/.test(s))return"positive";if(/negative|negatif|отрицат|плох|bad/.test(s))return"negative";if(/neutral|нейтр/.test(s))return"neutral";return s}

// Нормализация ответа по уровню существительных к one-of: high/medium/low
function normalizeLevel(raw){let s=firstLineLower(raw);if(/\b(high|many|>?\s*15|\bmore than 15\b|более\s*15|много)\b/.test(s))return"high";if(/\b(medium|6-15|6 to 15|средн|от\s*6\s*до\s*15)\b/.test(s))return"medium";if(/\b(low|few|<\s*6|мало|менее\s*6)\b/.test(s))return"low";return s}

// Универсальный вызов API Hugging Face Falcon-7B-Instruct (text-generation)
async function callApi(prompt,text){
  const url="https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct";
  const h={"Content-Type":"application/json"};
  const tok=S.token.value.trim();
  if(tok)h.Authorization="Bearer "+tok; // Добавляем Bearer, если токен введён
  const body={inputs:prompt+text};
  const r=await fetch(url,{method:"POST",headers:h,body:JSON.stringify(body)});
  if(r.status===402)throw new Error("Payment required or model unavailable (402). Provide a valid Hugging Face token.");
  if(r.status===429)throw new Error("Rate limited (429). Please slow down and try again.");
  if(!r.ok){let e=await r.text();throw new Error("API error "+r.status+": "+e.slice(0,200))}
  let data=await r.json();
  // Извлекаем сгенерированный текст из типичных форматов ответа
  if(Array.isArray(data)&&data.length&&data[0].generated_text)return data[0].generated_text;
  if(data&&data.generated_text)return data.generated_text;
  if(typeof data==="string")return data;
  return JSON.stringify(data)
}

// Выбор случайного отзыва и сброс результатов
function rand(){
  if(!S.reviews.length)return;
  const i=Math.floor(Math.random()*S.reviews.length);
  S.textEl.textContent=S.reviews[i].text||"";
  S.sent.querySelector("span").textContent="Sentiment: —";
  S.sent.className="pill";
  S.sent.querySelector("i").className="fa-regular fa-face-meh";
  S.nouns.querySelector("span").textContent="Noun level: —";
  S.nouns.className="pill";
  setErr("")
}

// Удаление URL, email и @упоминаний
function stripNoise(t){return (t||"").replace(/https?:\/\/\S+/g," ").replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g," ").replace(/(^| )@\w+/g," ").replace(/[^\S\r\n]+/g," ").trim()}

// Токенизация: слова и эмодзи (Unicode)
function toTokens(t){const x=stripNoise(t).toLowerCase();const m=x.match(/([\p{L}\p{M}]+|[\p{Emoji_Presentation}\p{Emoji}\u2600-\u27BF])/gu)||[];return m}

// Простейшая лемматизация en/ru через усечение окончаний
function lemma(tok){
  if(!tok)return tok;
  let t=tok.toLowerCase();
  t=t.replace(/'s$/,"");
  t=t.replace(/(ing|ed|ers|er|ies|s)$/,"");
  t=t.replace(/(ами|ями|ами|ов|ев|ев|ом|ем|ам|ям|ах|ях|ую|юю|ое|ее|ая|яя|ий|ый|ой|ые|ие|ого|его|ему|ому|ими|ыми|ого|его|ую|юю|яя|ая|ов|ев|ей|ьи|ью|ью|ям|ях|ам|ах| tion|ment)$/,"");
  return t
}

// Мини-лексикон базовых весов для сентимента
const POS_LEX={pos:new Set(["good","great","excellent","love","like","wonderful","refreshing","delicious","easy","better","best","recommend","loved","amazing","perfect","удобн","хорош","отличн","любл","нрав","прекрасн","классн","супер","рекоменд"]),neg:new Set(["bad","worse","worst","awful","terrible","greasy","gross","harsh","notgood","hate","dislike","problem","issues","poor","tastes","smells","плох","хуже","ужасн","мерзк","жирн","проблем","неприятн","плохой","отврат"])};

// Списки модификаторов/негаторов
const NEGATORS=new Set(["не","нет","no","not","never"]);
const BOOST=new Set(["very","очень"]);
const MITI=new Set(["slightly","немного","чуть"]);

// Локальная оценка тональности по требованиям (нормализация, инверсия, модификаторы, восклицания)
function sentimentLocal(t){
  const toks=toTokens(t).map(lemma);
  let score=0,count=0;
  let ex=(t.match(/!/g)||[]).length;
  let exMul=1+0.1*Math.min(3,ex); // Усиление за "!"
  for(let i=0;i<toks.length;i++){
    let w=0;let tk=toks[i];
    if(POS_LEX.pos.has(tk))w=1;else if(POS_LEX.neg.has(tk))w=-1;else w=0;
    if(w!==0){
      // Проверка негатора в пределах 3 токенов назад до пунктуации
      let j=i-1;let inv=false;let mul=1;
      for(let k=1;k<=3&&j>=0;k++,j--){
        let p=toks[j];
        if(NEGATORS.has(p)){inv=true;break}
        if(/[.,;:!?]/.test(p))break
      }
      // Интенсификатор/смягчитель сразу перед словом
      if(toks[i-1]&&BOOST.has(toks[i-1]))mul*=1.5;
      if(toks[i-1]&&MITI.has(toks[i-1]))mul*=0.6;
      if(inv)w*=-1;
      w*=mul;
      w*=exMul;
      score+=w;count++
    }
  }
  // Нормализация и ограничение
  let denom=Math.max(1,Math.sqrt(count));
  let s=score/denom;
  s=Math.max(-4,Math.min(4,s));
  let icon=s>=0?"👍":"👎";
  let conf=Math.min(1,Math.abs(s)/2);
  return{icon,confidence:conf}
}

// Загрузка TSV через Papa Parse → массив отзывов
async function loadTSV(){
  return new Promise((res,rej)=>{
    Papa.parse("./reviews_test.tsv",{download:true,delimiter:"\t",header:true,complete:r=>{const rows=(r.data||[]).filter(x=>x&&x.text);res(rows)},error:e=>rej(e)})
  })
}

// Обработчик кнопки "Analyze Sentiment": вызов API + локальная метка/уверенность
async function onSent(){
  const txt=S.textEl.textContent.trim();
  if(!txt){setErr("Select a review first.");return}
  setErr("");
  setSpin(true);
  try{
    const out=await callApi("Classify this review as positive, negative, or neutral: ",txt);
