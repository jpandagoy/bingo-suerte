/* Bingo de la Suerte · app (escáner de cartones + tablero de bolas + alertas). Todo local en el teléfono (IndexedDB). */
"use strict";
const APPV="bds-1.0";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const colOf=v=>v>=90?8:Math.floor(v/10);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

/* ================= base de datos ================= */
const DB=(()=>{let db;
  const open=()=>db?Promise.resolve(db):new Promise((res,rej)=>{const r=indexedDB.open("bingo-suerte",1);
    r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore("games",{keyPath:"id"});const c=d.createObjectStore("cards",{keyPath:"id"});c.createIndex("game","gameId");d.createObjectStore("meta")};
    r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)});
  const tx=async(st,mode,fn)=>{const d=await open();return new Promise((res,rej)=>{const t=d.transaction(st,mode),s=t.objectStore(st);let out;const r=fn(s);if(r)r.onsuccess=()=>{out=r.result};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error)})};
  return{
    all:st=>tx(st,"readonly",s=>s.getAll()),
    put:(st,v)=>tx(st,"readwrite",s=>s.put(v)),
    del:(st,k)=>tx(st,"readwrite",s=>s.delete(k)),
    byGame:async g=>{const d=await open();return new Promise((res,rej)=>{const r=d.transaction("cards").objectStore("cards").index("game").getAll(g);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
    getMeta:k=>tx("meta","readonly",s=>s.get(k)),
    setMeta:(k,v)=>tx("meta","readwrite",s=>s.put(v,k)),
  }})();

/* ================= estado ================= */
const S={games:[],game:null,cards:[],view:"games",filter:"all"};
const called=()=>new Set(S.game?S.game.draws:[]);
async function loadAll(){
  S.games=(await DB.all("games")).sort((a,b)=>b.created-a.created);
  const cur=await DB.getMeta("current");S.game=S.games.find(g=>g.id===cur)||S.games[0]||null;
  S.cards=S.game?await DB.byGame(S.game.id):[];
}
async function setGame(g){S.game=g;await DB.setMeta("current",g?g.id:null);S.cards=g?await DB.byGame(g.id):[];renderAll()}
let saveT=null;function saveGame(){clearTimeout(saveT);const g=S.game;saveT=setTimeout(()=>DB.put("games",g),60)}

/* ================= utilidades UI ================= */
let toastT;function toast(m,ms){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("on"),ms||2200)}
let AC=null;function beep(seq){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();let t=AC.currentTime;for(const [f,d] of seq){const o=AC.createOscillator(),g=AC.createGain();o.type="square";o.frequency.value=f;g.gain.setValueAtTime(.18,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(AC.destination);o.start(t);o.stop(t+d);t+=d+.04}}catch(e){}}
const buzz=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}};
let wake=null;async function keepAwake(on){try{if(on&&!wake&&navigator.wakeLock){wake=await navigator.wakeLock.request("screen");wake.addEventListener("release",()=>{wake=null})}else if(!on&&wake){await wake.release();wake=null}}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&(S.view==="play"||S.view==="scan"))keepAwake(true)});
function ask(html,buttons){return new Promise(res=>{const d=$("#dlg");d.innerHTML=html+`<div class="row" style="justify-content:flex-end;margin-top:14px">${buttons.map((b,i)=>`<button class="btn sm ${b.cls||""}" data-i="${i}">${esc(b.t)}</button>`).join("")}</div>`;
  d.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{const v=buttons[+b.dataset.i].v;const f=d.querySelector("input");d.close();res(v==="__input"?(f?f.value:""):v)});d.onclose=()=>res(null);d.showModal();const f=d.querySelector("input");if(f)setTimeout(()=>f.focus(),50)})}
const pad4=s=>{s=String(s||"").replace(/\D/g,"");return s?s.padStart(4,"0").slice(-4):""};

/* miniatura 3×9 de un cartón: clases por casilla */
function miniHTML(card,opts){opts=opts||{};const C=opts.called||new Set(),need=opts.need||new Set(),dub=new Set((card.dub||[]));let h='<div class="mini">';
  for(let r=0;r<3;r++)for(let c=0;c<9;c++){const v=(card.rows[r]||[]).find(n=>n!=null&&colOf(n)===c);
    if(v==null){h+='<div class="blk"></div>';continue}
    const cls=C.has(v)?"hit":need.has(v)?"need":dub.has(r*9+c)?"dub":"";h+=`<div class="${cls}">${v}</div>`}
  return h+"</div>"}

/* ================= navegación ================= */
function go(v){if((v==="scan"||v==="play"||v==="cards")&&!S.game){v="games";toast("Primero crea una partida")}S.view=v;$$("section.view").forEach(s=>s.classList.toggle("on",s.id==="v-"+v));$$("#tabs button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
  if(v!=="scan")Cam.stop();keepAwake(v==="play"||v==="scan");
  render[v]&&render[v]();$("main").scrollTop=0}
$$("#tabs button").forEach(b=>b.onclick=()=>go(b.dataset.v));
function renderHeader(){const g=S.game;$("#hSub").textContent=g?`${g.name||"Partida"} · ${S.cards.length} cartones`:"Sin partida";$("#hSerieV").textContent=g&&g.serie?g.serie:"—";
  const rv=S.cards.filter(c=>c.status==="review").length,b=$("#revBadge");b.hidden=!rv;b.textContent=rv}
$("#hSerie").onclick=async()=>{if(!S.game)return;const v=await ask(`<h2 style="margin-top:0">Serie de la partida</h2><p class="mut small">Se usa para los cartones nuevos que escanees. Los ya guardados conservan la suya.</p><div class="field"><input inputmode="numeric" maxlength="4" value="${esc(S.game.serie||"")}"></div>`,[{t:"Cancelar",v:null},{t:"Guardar",v:"__input",cls:"pri"}]);
  if(v==null)return;S.game.serie=pad4(v);await DB.put("games",S.game);renderHeader()};
const render={};
function renderAll(){renderHeader();render[S.view]&&render[S.view]()}

/* ================= PARTIDAS ================= */
render.games=()=>{const L=$("#gList");if(!S.games.length){L.innerHTML='<div class="empty">Aún no hay partidas.</div>'}else
  L.innerHTML=S.games.map(g=>`<div class="gitem ${S.game&&g.id===S.game.id?"cur":""}" data-id="${g.id}"><div class="grow"><b>${esc(g.name||"Partida")} · Serie ${esc(g.serie||"—")}</b><span class="mut small">${new Date(g.created).toLocaleString("es-EC",{dateStyle:"medium",timeStyle:"short"})} · ${g.draws.length} bolas</span></div>
    ${S.game&&g.id===S.game.id?'<span class="chip"><b>Activa</b></span>':'<button class="btn sm" data-a="use">Usar</button>'}<button class="btn sm bad" data-a="del" aria-label="Borrar">✕</button></div>`).join("");
  L.querySelectorAll("[data-a]").forEach(b=>b.onclick=async()=>{const id=b.closest(".gitem").dataset.id,g=S.games.find(x=>x.id===id);
    if(b.dataset.a==="use"){await setGame(g);toast("Partida activa: "+(g.name||"Partida"));return}
    const n=(await DB.byGame(id)).length;if(await ask(`<h2 style="margin-top:0">¿Borrar partida?</h2><p>${esc(g.name||"Partida")} · ${n} cartones. No se puede deshacer.</p>`,[{t:"Cancelar",v:false},{t:"Borrar",v:true,cls:"bad"}])!==true)return;
    for(const c of await DB.byGame(id))await DB.del("cards",c.id);await DB.del("games",id);S.games=S.games.filter(x=>x.id!==id);if(S.game&&S.game.id===id)await setGame(S.games[0]||null);else renderAll()});
  $("#appVer").textContent="Versión "+APPV+" · funciona sin internet una vez instalada";
};
$("#gCreate").onclick=async()=>{const serie=pad4($("#gSerie").value);if(!serie){toast("Escribe la serie (los 4 dígitos rojos del cartón)");$("#gSerie").focus();return}
  const g={id:uid(),name:$("#gName").value.trim(),serie,created:Date.now(),draws:[],phase:"linea",alerted:{linea:[],full:[]}};
  await DB.put("games",g);S.games.unshift(g);$("#gName").value="";$("#gSerie").value="";await setGame(g);go("scan")};
$("#bExport").onclick=async()=>{const data={app:"bingo-suerte",v:APPV,at:new Date().toISOString(),games:await DB.all("games"),cards:await DB.all("cards")};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"}));a.download=`bingo-suerte-${new Date().toISOString().slice(0,10)}.json`;a.click()};
$("#bImport").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;try{const d=JSON.parse(await f.text());if(d.app!=="bingo-suerte")throw 0;
  for(const g of d.games)await DB.put("games",g);for(const c of d.cards)await DB.put("cards",c);await loadAll();renderAll();toast(`Importado: ${d.games.length} partidas, ${d.cards.length} cartones`)}catch(err){toast("Ese archivo no es una copia de esta app")}};

/* ================= LECTURA DE CARTONES ================= */
function toCanvas(src,maxSide){const w=src.videoWidth||src.naturalWidth||src.width,h=src.videoHeight||src.naturalHeight||src.height,k=Math.min(1,(maxSide||4000)/Math.max(w,h));
  const c=document.createElement("canvas");c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext("2d").drawImage(src,0,0,c.width,c.height);return c}
/* lee un cartón ya localizado (esquinas) → objeto de cartón */
function readCard(img,corners){
  let r=BSReader.readGrid(img,corners,0);
  if(r.doubts.length>2){const r2=BSReader.readGrid(img,corners,1);if(r2.doubts.length<r.doubts.length)r=r2}
  const dub=[];const msgs=[];
  r.cells.forEach((row,ri)=>row.forEach(n=>{if(n.v==null||n.conf<.08||n.why)dub.push(ri*9+n.c)}));
  for(const d of r.doubts)if(d.why!=="poco seguro"&&d.why!=="sin dígito"&&d.why!=="un solo dígito")msgs.push(d.why);
  const carton=/^\d{3,4}$/.test(r.carton)?pad4(r.carton):"";if(!carton||r.cartonConf<.05)msgs.push("revisa el nº de cartón");
  const rows=r.rows.map(row=>row.map(v=>v==null?null:v));
  const ok=!dub.length&&!msgs.length&&rows.flat().every(v=>v!=null);
  return{carton,serieRead:pad4(r.serie),rows,dub,msgs:[...new Set(msgs)],ok,thumb:r.thumb.toDataURL("image/jpeg",.72)};
}
const sameNums=(a,b)=>JSON.stringify(a.rows)===JSON.stringify(b.rows);
/* guarda el resultado de una lectura en la partida; devuelve {kind:"ok"|"review"|"dup", card} */
async function storeRead(rd){
  const g=S.game,serie=g.serie||"";
  const prev=S.cards.find(c=>c.carton&&c.carton===rd.carton&&c.serie===serie);
  if(prev&&sameNums(prev,rd))return{kind:"dup",card:prev};
  const card={id:uid(),gameId:g.id,carton:rd.carton,serie,rows:rd.rows,dub:rd.dub,msgs:rd.msgs.slice(),thumb:rd.thumb,created:Date.now(),status:rd.ok?"ok":"review"};
  if(prev){card.status="review";card.msgs.push(`el cartón ${rd.carton} ya está guardado con otros números`)}
  await DB.put("cards",card);S.cards.push(card);renderHeader();return{kind:card.status,card};
}
/* imagen con uno o varios cartones (foto de grupo / galería) */
async function readImage(img){
  const full=toCanvas(img,3200);const dets=BSReader.detect(full,{multi:true,maxSide:1400});const res=[];
  for(const d of dets){const b=d.box,x0=Math.max(0,b.x-b.w*.12),y0=Math.max(0,b.y-b.h*.45),x1=Math.min(full.width,b.x+b.w*1.12),y1=Math.min(full.height,b.y+b.h*1.15);
    const c=document.createElement("canvas");c.width=Math.round(x1-x0);c.height=Math.round(y1-y0);c.getContext("2d").drawImage(full,x0,y0,c.width,c.height,0,0,c.width,c.height);
    const one=BSReader.detect(c);if(!one.length)continue;try{res.push(readCard(c,one[0].corners))}catch(e){console.warn(e)}}
  return res;
}
async function importImages(imgs,label){
  let ok=0,rev=0,dup=0,none=0;
  for(const im of imgs){const rds=await readImage(im);if(!rds.length)none++;for(const rd of rds){const s=await storeRead(rd);if(s.kind==="ok")ok++;else if(s.kind==="review")rev++;else dup++;showLast(s)}}
  toast(`${label}: ${ok} guardados${rev?` · ${rev} por revisar`:""}${dup?` · ${dup} repetidos`:""}${none?` · ${none} sin cartón`:""}`,4000);
  if(ok||rev){beep([[880,.08],[1320,.12]]);buzz(80)}
}
function showLast(s){const c=s.card,box=$("#lastScan");
  box.innerHTML=`<div class="cardbox ${c.status==="review"?"review":""}"><div class="cardhead"><span>Cartón ${esc(c.carton||"¿?")}</span><span class="ser">Serie ${esc(c.serie)}</span><span class="sp"></span>
   <span class="chip">${s.kind==="dup"?"Ya estaba":c.status==="review"?"⚠ Revisar":"✓ Guardado"}</span><button class="btn sm" data-e>Editar</button></div>${miniHTML(c)}${c.msgs&&c.msgs.length?`<div class="msgs">${c.msgs.map(esc).join(" · ")}</div>`:""}</div>`;
  box.querySelector("[data-e]").onclick=()=>editCard(c)}

/* ================= ESCÁNER EN VIVO ================= */
const Cam=(()=>{
  let stream=null,track=null,run=false,busy=false,timer=null,hist=[],locked=false,lostN=0,lockQuad=null,lockRows=[],lockT=0,fails=0,torch=false;
  const video=$("#video"),ov=$("#overlay"),msg=$("#scanMsg"),small=document.createElement("canvas");
  const say=(t,cls)=>{msg.textContent=t;msg.className=cls||""};
  async function start(){
    if(!S.game){toast("Primero crea una partida");return}
    try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}})}
    catch(e){say("No pude abrir la cámara: "+(e.name==="NotAllowedError"?"da permiso a la cámara en el navegador":e.message),"warn");return}
    track=stream.getVideoTracks()[0];video.srcObject=stream;await video.play().catch(()=>{});
    try{const cap=track.getCapabilities?track.getCapabilities():{};const adv=[];if(cap.focusMode&&cap.focusMode.includes("continuous"))adv.push({focusMode:"continuous"});if(adv.length)await track.applyConstraints({advanced:adv});
      $("#tTorch").disabled=!cap.torch}catch(e){}
    $("#tGroup").disabled=false;$("#scanStart").style.display="none";run=true;hist=[];locked=false;fails=0;say("Apunta al cartón");loop();
  }
  function stop(){run=false;clearTimeout(timer);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}track=null;torch=false;$("#scanStart").style.display="";$("#tTorch").disabled=true;$("#tGroup").disabled=true;
    const x=ov.getContext("2d");x.clearRect(0,0,ov.width,ov.height)}
  function mapPt(p,vw,vh){const W=ov.clientWidth,H=ov.clientHeight,k=Math.min(W/vw,H/vh);return[(p[0]*vw/small.width)*k+(W-vw*k)/2,(p[1]*vh/small.height)*k+(H-vh*k)/2]}
  function draw(q,color){const x=ov.getContext("2d"),dpr=devicePixelRatio||1;if(ov.width!==ov.clientWidth*dpr){ov.width=ov.clientWidth*dpr;ov.height=ov.clientHeight*dpr}
    x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,ov.width,ov.height);if(!q)return;const vw=video.videoWidth,vh=video.videoHeight,P=q.map(p=>mapPt(p,vw,vh));
    x.lineWidth=4;x.strokeStyle=color;x.fillStyle=color.replace("1)",".14)");x.beginPath();P.forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1]));x.closePath();x.fill();x.stroke()}
  const center=q=>[(q[0][0]+q[1][0]+q[2][0]+q[3][0])/4,(q[0][1]+q[1][1]+q[2][1]+q[3][1])/4];
  function loop(){if(!run)return;timer=setTimeout(tick,110)}
  function tick(){
    if(!run)return;if(busy||!video.videoWidth){loop();return}
    const vw=video.videoWidth,vh=video.videoHeight,k=Math.min(1,640/Math.max(vw,vh));small.width=Math.round(vw*k);small.height=Math.round(vh*k);
    small.getContext("2d",{willReadFrequently:true}).drawImage(video,0,0,small.width,small.height);
    const d=BSReader.detect(small,{maxSide:640})[0];const W=small.width;
    if(!d){hist=[];draw(null);if(locked){lostN++;if(lostN>=3){locked=false;fails=0}}if(!locked)say("Apunta al cartón (entero, con el nº de cartón arriba)");loop();return}
    const q=d.corners;
    if(locked){const c0=center(lockQuad),c1=center(q);if(Math.hypot(c0[0]-c1[0],c0[1]-c1[1])>W*.22){locked=false;fails=0}
      else{lostN=0;draw(q,"rgba(46,204,113,1)");
        // cambiaron el cartón sin sacarlo del encuadre: cada ~1,5 s se vuelve a leer y, si los números son otros, es un cartón nuevo
        hist.push(q);if(hist.length>3)hist.shift();const st=hist.length===3&&hist.every(h=>h.every((p,i)=>Math.hypot(p[0]-q[i][0],p[1]-q[i][1])<W*.012));
        if(st&&Date.now()-lockT>1500){lockT=Date.now();busy=true;setTimeout(()=>{try{const full=toCanvas(video,1920),fd=BSReader.detect(full)[0];
            if(fd){const rd=readCard(full,fd.corners),diff=rd.rows.flat().filter((v,i)=>v!==lockRows[i]).length;if(diff>=6&&rd.dub.length<=4){locked=false;busy=false;hist=[];capture(rd,q);return}}}catch(e){}busy=false;loop()},20);return}
        loop();return}}
    // tamaño mínimo: el cartón debe ocupar buena parte de la imagen
    const bw=Math.hypot(q[1][0]-q[0][0],q[1][1]-q[0][1]);if(bw<W*.45){hist=[];draw(q,"rgba(255,167,38,1)");say("Acércate un poco más");loop();return}
    hist.push(q);if(hist.length>3)hist.shift();
    const still=hist.length===3&&hist.every(h=>h.every((p,i)=>Math.hypot(p[0]-q[i][0],p[1]-q[i][1])<W*.012));
    draw(q,still?"rgba(46,204,113,1)":"rgba(255,204,51,1)");
    if(!still){say("Quieto…");loop();return}
    busy=true;say("Leyendo…");
    setTimeout(async()=>{try{
      const full=toCanvas(video,1920);const fd=BSReader.detect(full)[0];
      if(!fd){busy=false;hist=[];loop();return}
      const rd=readCard(full,fd.corners);
      if(!rd.ok&&rd.dub.length+rd.msgs.length>4&&fails<2){fails++;say("No se leyó bien: mejora la luz o acércate","warn");hist=[];busy=false;loop();return}
      busy=false;await capture(rd,q);return;
    }catch(e){console.error(e);say("Error al leer: "+e.message,"warn")}busy=false;loop()},30);
  }
  async function capture(rd,q){busy=true;try{
      const s=await storeRead(rd);showLast(s);locked=true;lockQuad=q;lockRows=rd.rows.flat();lockT=Date.now();lostN=0;fails=0;hist=[];
      if(s.kind==="dup"){say(`Cartón ${s.card.carton} ya estaba guardado`,"warn");buzz(40)}
      else if(s.kind==="ok"){say(`✓ Cartón ${s.card.carton} guardado · ${S.cards.length} en total — pon el siguiente`,"good");beep([[1046,.07],[1568,.1]]);buzz(90)}
      else{say(`⚠ Cartón ${s.card.carton||"¿?"} guardado para revisar — pon el siguiente`,"warn");beep([[660,.12]]);buzz([60,60,60])}
    }catch(e){console.error(e);say("Error al guardar: "+e.message,"warn")}busy=false;loop()}
  async function group(){
    if(!track)return;busy=true;say("Tomando foto de grupo…");
    try{let img;if(window.ImageCapture){try{const ic=new ImageCapture(track);const blob=await ic.takePhoto();img=await createImageBitmap(blob)}catch(e){img=null}}
      if(!img)img=toCanvas(video);
      await importImages([img],"Foto de grupo");say("Listo. Apunta al siguiente cartón o toma otra foto");
    }catch(e){say("Error: "+e.message,"warn")}busy=false;locked=false;hist=[]}
  async function setTorch(){if(!track)return;torch=!torch;try{await track.applyConstraints({advanced:[{torch}]});$("#tTorch").classList.toggle("pri",torch)}catch(e){toast("Esta cámara no permite linterna")}}
  return{start,stop,group,setTorch}})();
$("#camStart").onclick=()=>Cam.start();$("#tGroup").onclick=()=>Cam.group();$("#tTorch").onclick=()=>Cam.setTorch();
$("#tFiles").onchange=async e=>{const fs=[...e.target.files];e.target.value="";if(!fs.length)return;toast(`Leyendo ${fs.length} foto(s)…`,8000);
  const imgs=[];for(const f of fs){try{imgs.push(toCanvas(await createImageBitmap(f),3200))}catch(err){}}await importImages(imgs,"Galería")};
render.scan=()=>{renderHeader()};

/* ================= CARTONES ================= */
render.cards=()=>{const C=S.cards.slice().sort((a,b)=>(a.status==="review")-(b.status==="review")||String(a.carton).localeCompare(String(b.carton))).sort((a,b)=>(b.status==="review")-(a.status==="review"));
  const rv=C.filter(c=>c.status==="review").length;$("#cCount").textContent=`${C.length} cartón${C.length===1?"":"es"}`;$("#cSub").textContent=rv?`${rv} por revisar (toca para corregir)`:"Todos verificados";
  $$("#cSeg button").forEach(b=>b.classList.toggle("on",b.dataset.f===S.filter));
  const L=C.filter(c=>S.filter==="all"||c.status==="review");
  $("#cList").innerHTML=L.length?L.map(c=>`<div class="cardbox ${c.status==="review"?"review":""}" data-id="${c.id}"><div class="cardhead"><span>Cartón ${esc(c.carton||"¿?")}</span><span class="ser">Serie ${esc(c.serie||"—")}</span><span class="sp"></span>${c.status==="review"?'<span class="chip" style="color:var(--warn)">⚠ Revisar</span>':""}</div>${miniHTML(c)}${c.msgs&&c.msgs.length&&c.status==="review"?`<div class="msgs">${c.msgs.map(esc).join(" · ")}</div>`:""}</div>`).join("")
    :`<div class="empty">${S.filter==="review"?"Nada por revisar 👍":"Aún no hay cartones. Ve a <b>Escanear</b>."}</div>`;
  $$("#cList .cardbox").forEach(el=>el.onclick=()=>editCard(S.cards.find(c=>c.id===el.dataset.id)));renderHeader()};
$$("#cSeg button").forEach(b=>b.onclick=()=>{S.filter=b.dataset.f;render.cards()});
$("#cAdd").onclick=()=>editCard(null);

/* editor de un cartón (corrección o alta manual) */
function editCard(card){
  const isNew=!card;card=card||{id:uid(),gameId:S.game.id,carton:"",serie:S.game.serie||"",rows:[[],[],[]],dub:[],msgs:[],thumb:"",created:Date.now(),status:"review"};
  const d=$("#dlg"),dub=new Set(card.dub||[]);let cells="";
  for(let r=0;r<3;r++)for(let c=0;c<9;c++){const v=(card.rows[r]||[]).find(n=>n!=null&&colOf(n)===c);cells+=`<input inputmode="numeric" maxlength="2" data-r="${r}" data-c="${c}" value="${v??""}" class="${v==null?"blk":dub.has(r*9+c)?"dub":""}">`}
  d.innerHTML=`<h2 style="margin:0 0 10px">${isNew?"Agregar cartón":"Cartón "+esc(card.carton||"¿?")}</h2>
    ${card.thumb?`<img class="thumb" src="${card.thumb}" alt="foto del cartón">`:""}
    <div class="row" style="margin-top:10px"><div class="field grow" style="margin:0"><label>Nº de cartón</label><input id="eC" inputmode="numeric" maxlength="4" value="${esc(card.carton)}"></div><div class="field grow" style="margin:0"><label>Serie</label><input id="eS" inputmode="numeric" maxlength="4" value="${esc(card.serie)}"></div></div>
    <p class="mut small" style="margin:10px 0 0">Compara con la foto. Amarillo = el lector no estaba seguro. Casillas negras = sin número (escribe en ellas si falta alguno).</p>
    <div class="edgrid" id="eG">${cells}</div><div class="msgs" id="eM"></div>
    <div class="row" style="margin-top:6px">${isNew?"":'<button class="btn sm bad" id="eDel">Borrar</button>'}<span class="grow"></span><button class="btn sm" id="eX">Cancelar</button><button class="btn sm ok" id="eOk">Guardar ✓</button></div>`;
  const ins=[...d.querySelectorAll("#eG input")];
  ins.forEach(i=>{i.oninput=()=>{i.value=i.value.replace(/\D/g,"");i.classList.toggle("blk",!i.value);i.classList.remove("dub","bad");if(i.value.length===2){const n=ins[ins.indexOf(i)+1];if(n)n.focus()}};i.onfocus=()=>i.select()});
  d.querySelector("#eX").onclick=()=>d.close();
  if(!isNew){const bd=d.querySelector("#eDel");bd.onclick=async()=>{if(!bd.dataset.sure){bd.dataset.sure=1;bd.textContent="¿Seguro? Toca otra vez";return}await DB.del("cards",card.id);S.cards=S.cards.filter(c=>c.id!==card.id);d.close();toast("Cartón borrado");renderAll()}}
  d.querySelector("#eOk").onclick=async()=>{
    const err=[],rows=[[],[],[]];ins.forEach(i=>i.classList.remove("bad"));
    for(const i of ins){if(!i.value)continue;const v=+i.value,c=+i.dataset.c,r=+i.dataset.r;if(v<1||v>90||colOf(v)!==c){i.classList.add("bad");err.push(`${v} no va en esa columna`)}else rows[r].push(v)}
    rows.forEach((r,k)=>{if(r.length!==5)err.push(`la fila ${k+1} tiene ${r.length} números (deben ser 5)`)});
    const all=rows.flat();if(new Set(all).size!==all.length)err.push("hay números repetidos");
    for(let c=0;c<9;c++){const col=[0,1,2].map(r=>rows[r].find(v=>colOf(v)===c)).filter(v=>v!=null);for(let k=1;k<col.length;k++)if(col[k]<=col[k-1])err.push(`columna ${c+1}: deben ir de menor a mayor hacia abajo`)}
    const carton=pad4(d.querySelector("#eC").value),serie=pad4(d.querySelector("#eS").value);if(!carton)err.push("falta el nº de cartón");
    const twin=S.cards.find(c=>c.id!==card.id&&c.carton===carton&&c.serie===serie);if(twin)err.push(`ya existe el cartón ${carton} serie ${serie}`);
    if(err.length){d.querySelector("#eM").textContent=[...new Set(err)].join(" · ");return}
    Object.assign(card,{carton,serie,rows:rows.map(r=>r.sort((a,b)=>a-b)),dub:[],msgs:[],status:"ok"});await DB.put("cards",card);
    if(isNew)S.cards.push(card);d.close();toast(`Cartón ${carton} guardado`);renderAll()};
  d.onclose=null;d.showModal();
}

/* ================= JUGAR ================= */
function evalCards(){const C=called(),out=[];
  for(const c of S.cards){const miss=c.rows.map(r=>r.filter(v=>v!=null&&!C.has(v)));const lens=miss.map(m=>m.length);const best=Math.min(...lens);
    out.push({c,miss,best,bestRow:lens.indexOf(best),total:lens.reduce((a,b)=>a+b,0)})}
  return out}
function buildBoard(){const B=$("#board");let h="";
  for(let t=0;t<9;t++)for(let u=0;u<10;u++){const v=t*10+u;h+=v===0?'<button class="ph" tabindex="-1"></button>':`<button data-n="${v}">${v}</button>`}
  h+='<button data-n="90">90</button><button class="util undo" id="bUndo" style="grid-column:span 5">↶ Deshacer</button><button class="util" id="bMore" style="grid-column:span 4">Más…</button>';
  B.innerHTML=h;
  B.onclick=e=>{const b=e.target.closest("button[data-n]");if(!b)return;toggleBall(+b.dataset.n)};
  $("#bUndo").onclick=()=>{const g=S.game;if(!g.draws.length)return;const v=g.draws.pop();afterChange();toast("Quitada la bola "+v)};
  $("#bMore").onclick=moreMenu;
  $$("#phase button").forEach(b=>b.onclick=()=>{S.game.phase=b.dataset.p;saveGame();render.play()});
}
function toggleBall(v){const g=S.game,i=g.draws.indexOf(v);
  if(i>=0){g.draws.splice(i,1);toast(`Bola ${v} desmarcada`);afterChange();return}
  g.draws.push(v);afterChange(v)}
function afterChange(newBall){
  const g=S.game;saveGame();const ev=evalCards();
  // las alertas ya dadas se retiran si la bola se quitó
  g.alerted=g.alerted||{linea:[],full:[]};
  g.alerted.linea=g.alerted.linea.filter(id=>ev.find(e=>e.c.id===id&&e.best===0));g.alerted.full=g.alerted.full.filter(id=>ev.find(e=>e.c.id===id&&e.total===0));
  render.play(newBall);
  if(newBall==null)return;
  const fullW=ev.filter(e=>e.total===0&&!g.alerted.full.includes(e.c.id));
  const lineW=g.phase==="linea"?ev.filter(e=>e.best===0&&!g.alerted.linea.includes(e.c.id)):[];
  if(fullW.length){fullW.forEach(e=>g.alerted.full.push(e.c.id));lineW.forEach(e=>g.alerted.linea.push(e.c.id));saveGame();showAlert("full",fullW)}
  else if(lineW.length){lineW.forEach(e=>g.alerted.linea.push(e.c.id));saveGame();showAlert("linea",lineW)}
  else{const ev1=ev.filter(e=>g.phase==="linea"?e.best===1:e.total===1);if(ev1.length)buzz(25)}
}
function showAlert(kind,wins){
  const A=$("#alert"),w=wins[0],C=called();A.className="on "+(kind==="full"?"full":"");
  $("#aT").innerHTML=kind==="full"?"¡BINGO!<small>TABLA LLENA</small>":"¡LÍNEA!";
  $("#aWho").innerHTML=`Cartón ${esc(w.c.carton||"¿?")} · <span class="ser">Serie ${esc(w.c.serie||"—")}</span>${w.c.status==="review"?' <span class="chip" style="color:var(--warn)">⚠ cartón sin revisar</span>':""}`;
  $("#aCard").innerHTML=miniHTML(w.c,{called:C});
  $("#aMore").textContent=(kind==="linea"?`Fila ${w.bestRow+1} completa. `:"")+(wins.length>1?`También: ${wins.slice(1).map(e=>"cartón "+e.c.carton).join(", ")}`:"");
  const acts=$("#aActs");acts.innerHTML=(kind==="linea"?'<button class="btn pri" data-a="full">Cobrado · seguir a tabla llena</button>':"")+'<button class="btn" data-a="x">Cerrar</button>';
  acts.querySelectorAll("button").forEach(b=>b.onclick=()=>{if(b.dataset.a==="full"){S.game.phase="full";saveGame();render.play()}A.className=""});
  beep(kind==="full"?[[784,.15],[988,.15],[1175,.15],[1568,.4],[1175,.15],[1568,.5]]:[[988,.14],[1319,.14],[1568,.35],[1319,.14],[1568,.4]]);
  buzz(kind==="full"?[400,120,400,120,400,120,800]:[300,120,300,120,600]);
}
async function moreMenu(){
  const v=await ask(`<h2 style="margin-top:0">Opciones del juego</h2><p class="mut small">${S.game.draws.length} bolas marcadas.</p>
    <div class="field"><label>Pegar o escribir varias bolas (separadas por espacio o coma)</label><input id="mBulk" inputmode="numeric" placeholder="Ej.: 5 18 44 90"></div>`,
    [{t:"Reiniciar bolas",v:"reset",cls:"bad"},{t:"Cerrar",v:null},{t:"Agregar",v:"__input",cls:"pri"}]);
  if(v==="reset"){if(await ask(`<h2 style="margin-top:0">¿Borrar todas las bolas?</h2><p>Los cartones no se tocan.</p>`,[{t:"Cancelar",v:false},{t:"Borrar bolas",v:true,cls:"bad"}])===true){S.game.draws=[];S.game.alerted={linea:[],full:[]};S.game.phase="linea";afterChange()}return}
  if(typeof v==="string"&&v){const ns=(v.match(/\d+/g)||[]).map(Number).filter(n=>n>=1&&n<=90&&!S.game.draws.includes(n));let last=null;for(const n of ns){if(!S.game.draws.includes(n)){S.game.draws.push(n);last=n}}if(last!=null)afterChange(last)}
}
render.play=(newBall)=>{
  const g=S.game;if(!$("#board").children.length)buildBoard();
  $$("#phase button").forEach(b=>b.classList.toggle("on",b.dataset.p===(g.phase||"linea")));
  const C=called(),ev=evalCards(),phase=g.phase||"linea";
  // bolas que dan premio (le falta solo esa a algún cartón)
  const hot=new Set();for(const e of ev){if(phase==="linea"){e.miss.forEach(m=>{if(m.length===1)hot.add(m[0])})}else if(e.total===1)hot.add(e.miss.flat()[0])}
  $$("#board button[data-n]").forEach(b=>{const n=+b.dataset.n;b.classList.toggle("on",C.has(n));b.classList.toggle("hot",hot.has(n))});
  if(newBall){const b=$(`#board button[data-n="${newBall}"]`);if(b){b.classList.remove("flash");void b.offsetWidth;b.classList.add("flash")}}
  const last=g.draws[g.draws.length-1],bb=$("#bigBall");bb.className="bigball"+(last?"":" empty");bb.textContent=last||"—";
  $("#prevBalls").innerHTML=g.draws.slice(-7,-1).reverse().map(v=>`<span>${v}</span>`).join("");$("#ballCnt").textContent=g.draws.length;
  // los más cerca
  let list;
  if(phase==="linea")list=ev.slice().sort((a,b)=>a.best-b.best||a.total-b.total);
  else list=ev.slice().sort((a,b)=>a.total-b.total||a.best-b.best);
  list=list.slice(0,10);
  const N=$("#near");
  if(!S.cards.length){N.innerHTML='<div class="empty">No hay cartones en esta partida. Ve a <b>Escanear</b>.</div>';return}
  N.innerHTML=`<h3>${phase==="linea"?"Más cerca de LÍNEA":"Más cerca de TABLA LLENA"} <span class="mut small">· ${S.cards.length} cartones</span></h3>`+list.map(e=>{
    const m=phase==="linea"?e.miss[e.bestRow]:e.miss.flat(),k=phase==="linea"?e.best:e.total;
    const cls=k===0?"win":k===1?"one":"";
    const miss=k===0?'<span style="background:#14532d;color:#86efac">¡COMPLETO!</span>':(m.length<=8?m.map(v=>`<span>${v}</span>`).join(""):`<span class="mut" style="background:none;font-weight:500">aún lejos</span>`);
    return`<div class="nitem ${cls}" data-id="${e.c.id}"><div class="k">${esc(e.c.carton||"¿?")}<small>S ${esc(e.c.serie||"—")}</small></div><div class="miss">${miss}</div><div class="n">${phase==="linea"?`fila ${e.bestRow+1}<br>`:""}falta${k===1?"":"n"} ${k}</div></div>`}).join("");
  N.querySelectorAll(".nitem").forEach(el=>el.onclick=()=>{const c=S.cards.find(x=>x.id===el.dataset.id);const e=ev.find(x=>x.c.id===c.id);
    ask(`<h2 style="margin-top:0">Cartón ${esc(c.carton)} · <span style="color:#ff6b6b">Serie ${esc(c.serie)}</span></h2>${miniHTML(c,{called:C,need:new Set(phase==="linea"?e.miss[e.bestRow]:e.miss.flat())})}`,[{t:"Cerrar",v:null}])});
  renderHeader();
};

/* ================= arranque ================= */
(async()=>{
  try{const t=await (await fetch("tpl.json")).json();BSReader.setTemplates(t);const extra=await DB.getMeta("userTpl");if(extra)BSReader.addTemplates(extra)}catch(e){toast("No se cargaron las plantillas del lector")}
  await loadAll();renderAll();go(S.game?(S.cards.length?"play":"scan"):"games");
  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
