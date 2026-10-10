/* Bingo de la Suerte · app (escáner de cartones + tablero de bolas + alertas). Todo local en el teléfono (IndexedDB).
   Reglas de negocio: rules.js (única fuente de verdad). Bitácora: log.js (independiente). */
"use strict";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const colOf=Rules.colOf,pad4=Rules.pad4;
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

/* ================= base de datos ================= */
const DB=(()=>{let db;
  const open=()=>db?Promise.resolve(db):new Promise((res,rej)=>{const r=indexedDB.open("bingo-suerte",1);
    r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore("games",{keyPath:"id"});const c=d.createObjectStore("cards",{keyPath:"id"});c.createIndex("game","gameId");d.createObjectStore("meta")};
    r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>{Log.add("error","datos","DB_ERROR","no se pudo abrir la base de datos",{err:r.error});rej(r.error)}});
  const tx=async(st,mode,fn)=>{const d=await open();return new Promise((res,rej)=>{const t=d.transaction(st,mode),s=t.objectStore(st);let out;const r=fn(s);if(r)r.onsuccess=()=>{out=r.result};t.oncomplete=()=>res(out);
    t.onerror=()=>{Log.add("error","datos","DB_ERROR",`fallo al ${mode==="readonly"?"leer":"guardar"} en ${st}`,{err:t.error});rej(t.error)}})};
  return{
    all:st=>tx(st,"readonly",s=>s.getAll()),
    put:(st,v)=>tx(st,"readwrite",s=>s.put(v)),
    del:(st,k)=>tx(st,"readwrite",s=>s.delete(k)),
    byGame:async g=>{const d=await open();return new Promise((res,rej)=>{const r=d.transaction("cards").objectStore("cards").index("game").getAll(g);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
    getMeta:k=>tx("meta","readonly",s=>s.get(k)),
    setMeta:(k,v)=>tx("meta","readwrite",s=>s.put(v,k)),
  }})();

/* ================= modelo de cartón =================
   card.grid: 3×9 → número válido | null (casilla negra) | -1 (sin leer) ; card.rows: solo números válidos por fila
   card.status: "ok" (cumple TODAS las reglas y el lector estuvo seguro) | "review" */
function normalizeCard(c){if(!c.grid)c.grid=Rules.gridFromRows(c.rows);c.grid=c.grid.map(r=>r.map(v=>v==null?null:(v===-1||Rules.isNum(v))?v:-1));return c}
/* aplica TODAS las reglas al cartón; guarda el resultado en el cartón */
function applyRules(card,dub){
  const g=Rules.checkCard(card,S.cards);card.rows=g.rows;card.issues=g.errors.map(e=>e.code+" "+e.msg);card.warns=g.warnings.map(e=>e.code+" "+e.msg);
  card.bad=[...g.cellErr.keys()];card.dub=dub||card.dub||[];card.status=(!g.errors.length&&!card.dub.length)?"ok":"review";return g}

/* ================= estado ================= */
const S={games:[],game:null,cards:[],view:"games",filter:"all"};
const called=()=>new Set(S.game?S.game.draws:[]);
async function loadAll(){
  S.games=(await DB.all("games")).sort((a,b)=>b.created-a.created);
  const cur=await DB.getMeta("current");S.game=S.games.find(g=>g.id===cur)||S.games[0]||null;
  S.cards=S.game?(await DB.byGame(S.game.id)).map(normalizeCard):[];
  // re-validar con las reglas vigentes (cartones guardados con versiones anteriores)
  let changed=0;for(const c of S.cards){const was=c.status;applyRules(c,c.status==="ok"?[]:c.dub);if(was!==c.status){changed++;await DB.put("cards",c)}}
  if(changed)Log.add("warn","reglas","REVALIDATE",`${changed} cartón(es) cambiaron de estado al aplicar las reglas`,{game:S.game&&S.game.id});
}
async function setGame(g){S.game=g;await DB.setMeta("current",g?g.id:null);S.cards=g?(await DB.byGame(g.id)).map(normalizeCard):[];S.cards.forEach(c=>applyRules(c,c.status==="ok"?[]:c.dub));renderAll()}
let saveT=null;function saveGame(){clearTimeout(saveT);const g=S.game;saveT=setTimeout(()=>DB.put("games",g).catch(()=>{}),60)}

/* ================= utilidades UI ================= */
let toastT;function toast(m,ms){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("on"),ms||2400)}
let AC=null;function beep(seq){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();let t=AC.currentTime;for(const [f,d] of seq){const o=AC.createOscillator(),g=AC.createGain();o.type="square";o.frequency.value=f;g.gain.setValueAtTime(.18,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(AC.destination);o.start(t);o.stop(t+d);t+=d+.04}}catch(e){}}
const buzz=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}};
let wake=null;async function keepAwake(on){try{if(on&&!wake&&navigator.wakeLock){wake=await navigator.wakeLock.request("screen");wake.addEventListener("release",()=>{wake=null})}else if(!on&&wake){await wake.release();wake=null}}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&(S.view==="play"||S.view==="scan"))keepAwake(true)});
function ask(html,buttons){return new Promise(res=>{const d=$("#dlg");d.innerHTML=html+`<div class="row" style="justify-content:flex-end;margin-top:14px">${buttons.map((b,i)=>`<button class="btn sm ${b.cls||""}" data-i="${i}">${esc(b.t)}</button>`).join("")}</div>`;
  d.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{const v=buttons[+b.dataset.i].v;const f=d.querySelector("input");d.close();res(v==="__input"?(f?f.value:""):v)});d.onclose=()=>res(null);d.showModal();const f=d.querySelector("input");if(f)setTimeout(()=>f.focus(),50)})}

/* miniatura 3×9 de un cartón */
function miniHTML(card,opts){opts=opts||{};const C=opts.called||new Set(),need=opts.need||new Set(),dub=new Set(card.dub||[]),bad=new Set(card.bad||[]);let h='<div class="mini">';
  const G=card.grid||Rules.gridFromRows(card.rows);
  for(let r=0;r<3;r++)for(let c=0;c<9;c++){const i=r*9+c,v=G[r][c];
    if(v==null){h+='<div class="blk"></div>';continue}
    if(v===-1){h+='<div class="dub">?</div>';continue}
    const cls=bad.has(i)?"bad":C.has(v)?"hit":need.has(v)?"need":dub.has(i)?"dub":"";h+=`<div class="${cls}">${v}</div>`}
  return h+"</div>"}
const issuesHTML=c=>(c.issues&&c.issues.length?`<div class="msgs bad">${c.issues.map(m=>"✕ "+esc(m)).join("<br>")}</div>`:"")+(c.dub&&c.dub.length?`<div class="msgs">⚠ ${c.dub.length} número(s) leídos con poca seguridad (amarillo)</div>`:"")+(c.warns&&c.warns.length?`<div class="msgs">${c.warns.map(m=>"ⓘ "+esc(m)).join("<br>")}</div>`:"");

/* ================= navegación ================= */
function go(v){if((v==="scan"||v==="play"||v==="cards")&&!S.game){v="games";toast("Primero crea una partida")}
  if(S.view!==v)Log.add("info","app","NAV","→ "+v);S.view=v;$$("section.view").forEach(s=>s.classList.toggle("on",s.id==="v-"+v));$$("#tabs button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
  if(v!=="scan")Cam.stop();keepAwake(v==="play"||v==="scan");
  if(v==="log")Log.render();else render[v]&&render[v]();$("main").scrollTop=0}
$$("#tabs button").forEach(b=>b.onclick=()=>go(b.dataset.v));
function renderHeader(){const g=S.game;$("#hSub").textContent=g?`${g.name||"Partida"} · ${S.cards.length} cartones`:"Sin partida";$("#hSerieV").textContent=g&&g.serie?g.serie:"—";
  const rv=S.cards.filter(c=>c.status==="review").length,b=$("#revBadge");b.hidden=!rv;b.textContent=rv}
$("#hSerie").onclick=async()=>{if(!S.game)return;const v=await ask(`<h2 style="margin-top:0">Serie de la partida</h2><p class="mut small">Se usa para los cartones nuevos que escanees. Los ya guardados conservan la suya.</p><div class="field"><input inputmode="numeric" maxlength="4" value="${esc(S.game.serie||"")}"></div>`,[{t:"Cancelar",v:null},{t:"Guardar",v:"__input",cls:"pri"}]);
  if(v==null)return;if(!/^\d{1,4}$/.test(v.trim())){toast("La serie son 4 dígitos (ej.: 0479)");Log.add("warn","reglas","G01",`serie inválida: "${v}"`);return}
  const old=S.game.serie;S.game.serie=pad4(v);await DB.put("games",S.game);Log.add("info","partidas","SERIE",`serie ${old} → ${S.game.serie}`);renderHeader()};
const render={};
function renderAll(){renderHeader();if(S.view==="log")Log.render();else render[S.view]&&render[S.view]()}

/* ================= PARTIDAS ================= */
render.games=()=>{const L=$("#gList");if(!S.games.length){L.innerHTML='<div class="empty">Aún no hay partidas.</div>'}else
  L.innerHTML=S.games.map(g=>`<div class="gitem ${S.game&&g.id===S.game.id?"cur":""}" data-id="${g.id}"><div class="grow"><b>${esc(g.name||"Partida")} · Serie ${esc(g.serie||"—")}</b><span class="mut small">${new Date(g.created).toLocaleString("es-EC",{dateStyle:"medium",timeStyle:"short"})} · ${g.draws.length} bolas</span></div>
    ${S.game&&g.id===S.game.id?'<span class="chip"><b>Activa</b></span>':'<button class="btn sm" data-a="use">Usar</button>'}<button class="btn sm bad" data-a="del" aria-label="Borrar">✕</button></div>`).join("");
  L.querySelectorAll("[data-a]").forEach(b=>b.onclick=async()=>{const id=b.closest(".gitem").dataset.id,g=S.games.find(x=>x.id===id);
    if(b.dataset.a==="use"){await setGame(g);Log.add("info","partidas","USE",`partida activa: ${g.name||"Partida"} serie ${g.serie}`);toast("Partida activa: "+(g.name||"Partida"));return}
    const n=(await DB.byGame(id)).length;if(await ask(`<h2 style="margin-top:0">¿Borrar partida?</h2><p>${esc(g.name||"Partida")} · ${n} cartones. No se puede deshacer.</p>`,[{t:"Cancelar",v:false},{t:"Borrar",v:true,cls:"bad"}])!==true)return;
    for(const c of await DB.byGame(id))await DB.del("cards",c.id);await DB.del("games",id);Log.add("info","partidas","DELETE",`partida borrada (${n} cartones)`,{id});
    S.games=S.games.filter(x=>x.id!==id);if(S.game&&S.game.id===id)await setGame(S.games[0]||null);else renderAll()});
  $("#appVer").textContent="Versión "+APPV+" · funciona sin internet una vez instalada";
};
$("#gCreate").onclick=async()=>{const raw=$("#gSerie").value.trim();
  if(!/^\d{1,4}$/.test(raw)){toast("Escribe la serie: los dígitos rojos del cartón (ej.: 0479)");Log.add("warn","reglas","G01",`serie inválida al crear partida: "${raw}"`);$("#gSerie").focus();return}
  const g={id:uid(),name:$("#gName").value.trim(),serie:pad4(raw),created:Date.now(),draws:[],phase:"linea",alerted:{linea:[],full:[]}};
  await DB.put("games",g);S.games.unshift(g);Log.add("info","partidas","CREATE",`partida creada: ${g.name||"Partida"} serie ${g.serie}`,{id:g.id});$("#gName").value="";$("#gSerie").value="";await setGame(g);go("scan")};
$("#bExport").onclick=async()=>{const data={app:"bingo-suerte",v:APPV,at:new Date().toISOString(),games:await DB.all("games"),cards:await DB.all("cards")};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"}));a.download=`bingo-suerte-${new Date().toISOString().slice(0,10)}.json`;a.click();Log.add("info","partidas","EXPORT",`copia exportada: ${data.games.length} partidas, ${data.cards.length} cartones`)};
$("#bImport").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;try{const d=JSON.parse(await f.text());if(d.app!=="bingo-suerte"||!Array.isArray(d.games)||!Array.isArray(d.cards))throw new Error("no es una copia de esta app");
  let inval=0;for(const g of d.games){g.draws=(g.draws||[]).filter((v,i,a)=>Rules.isNum(v)&&a.indexOf(v)===i);await DB.put("games",g)}
  const byG={};for(const c of d.cards){normalizeCard(c);(byG[c.gameId]=byG[c.gameId]||[]).push(c)}
  for(const gid in byG){const list=byG[gid];for(const c of list){const save=S.cards;S.cards=list;applyRules(c,c.dub);S.cards=save;if(c.status==="review")inval++;await DB.put("cards",c)}}
  if(inval)Log.add("warn","reglas","IMPORT_INVALID",`${inval} cartón(es) importados no cumplen las reglas → Por revisar`);
  Log.add("info","partidas","IMPORT",`importado: ${d.games.length} partidas, ${d.cards.length} cartones`);await loadAll();renderAll();toast(`Importado: ${d.games.length} partidas, ${d.cards.length} cartones${inval?` (${inval} por revisar)`:""}`)}
  catch(err){Log.add("error","partidas","IMPORT_FAIL","no se pudo importar la copia",{err,file:f.name,size:f.size});toast("Ese archivo no es una copia válida de esta app")}};

/* ================= LECTURA DE CARTONES ================= */
function toCanvas(src,maxSide){const w=src.videoWidth||src.naturalWidth||src.width,h=src.videoHeight||src.naturalHeight||src.height,k=Math.min(1,(maxSide||4000)/Math.max(w,h));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));c.getContext("2d").drawImage(src,0,0,c.width,c.height);return c}
function rotate90(src){const c=document.createElement("canvas");c.width=src.height;c.height=src.width;const x=c.getContext("2d");x.translate(c.width,0);x.rotate(Math.PI/2);x.drawImage(src,0,0);return c}
/* lee un cartón ya localizado (esquinas) → resultado con cuadrícula 3×9 */
function readCard(img,corners){
  let r=BSReader.readGrid(img,corners,0),rot=0;
  if(r.doubts.length>2){const r2=BSReader.readGrid(img,corners,1);if(r2.doubts.length<r.doubts.length){r=r2;rot=180}}
  const grid=[...Array(3)].map(()=>Array(9).fill(null)),dub=[];
  r.cells.forEach((row,ri)=>row.forEach(n=>{const i=ri*9+n.c;grid[ri][n.c]=n.v==null?-1:n.v;if(n.v==null||n.conf<.08||n.why)dub.push(i)}));
  const carton=/^\d{1,4}$/.test(r.carton)?pad4(r.carton):"";if(carton&&r.cartonConf<.05)dub.push(-1);
  return{carton,serieRead:pad4(r.serie),grid,dub,rot,blacks:r.blacks,cartonConf:+(r.cartonConf||0).toFixed(3),doubts:r.doubts.map(d=>d.why),thumb:r.thumb.toDataURL("image/jpeg",.72)};
}
/* guarda una lectura aplicando TODAS las reglas → {kind:"ok"|"review"|"dup", card} */
async function storeRead(rd,src){
  const g=S.game,serie=g.serie||"";
  const card=normalizeCard({id:uid(),gameId:g.id,carton:rd.carton,serie,grid:rd.grid,thumb:rd.thumb,created:Date.now(),src});
  const prev=S.cards.find(c=>c.carton&&c.carton===rd.carton&&c.serie===serie);
  if(prev){const tmp=Rules.checkGrid(card.grid),srt=a=>a.flat().slice().sort((x,y)=>x-y).join();
    if(!tmp.errors.length&&srt(prev.rows)===srt(tmp.rows)){Log.add("info","lector","DUP",`cartón ${rd.carton} ya estaba guardado (mismos números)`,{src});return{kind:"dup",card:prev}}}
  const gres=applyRules(card,rd.dub.filter(i=>i>=0));if(rd.dub.includes(-1))card.issues.push("revisa el nº de cartón (lectura poco segura)"),card.status="review";
  await DB.put("cards",card);S.cards.push(card);renderHeader();
  const info={src,carton:card.carton,status:card.status,errors:gres.errors.map(e=>e.code+" "+e.msg),dudas:card.dub.length,doubts:rd.doubts,blacks:rd.blacks,cartonConf:rd.cartonConf,rot:rd.rot};
  if(card.status==="ok")Log.add("info","lector","READ_OK",`cartón ${card.carton} leído y validado`,info);
  else Log.add("warn","lector","READ_REVIEW",`cartón ${card.carton||"¿?"} guardado POR REVISAR: ${[...gres.errors.map(e=>e.code),card.dub.length?"dudas×"+card.dub.length:""].filter(Boolean).join(", ")}`,info);
  return{kind:card.status,card};
}
/* busca cartones en una imagen (1 o varios), con reintentos y diagnóstico */
function findCards(full){
  const tries=[],dbg=[];let dets=BSReader.detect(full,{multi:true,maxSide:1400,debug:dbg});tries.push({how:"multi",n:dets.length});
  let img=full;
  if(!dets.length){dets=BSReader.detect(full,{maxSide:900});tries.push({how:"single",n:dets.length})}
  if(!dets.length){img=rotate90(full);dets=BSReader.detect(img,{multi:true,maxSide:1400});tries.push({how:"girada 90°",n:dets.length})}
  const top=dbg.filter(x=>x.ar!=null).sort((a,b)=>b.a-a.a).slice(0,5);
  return{img,dets,tries,diag:{size:[full.width,full.height],mask:dbg[0]||null,candidatos:top}};
}
async function readImage(img){
  const full=toCanvas(img,3200),f=findCards(full),res=[];
  for(const d of f.dets){const b=d.box,x0=Math.max(0,b.x-b.w*.12),y0=Math.max(0,b.y-b.h*.45),x1=Math.min(f.img.width,b.x+b.w*1.12),y1=Math.min(f.img.height,b.y+b.h*1.15);
    const c=document.createElement("canvas");c.width=Math.round(x1-x0);c.height=Math.round(y1-y0);c.getContext("2d").drawImage(f.img,x0,y0,c.width,c.height,0,0,c.width,c.height);
    const one=BSReader.detect(c);if(!one.length){f.tries.push({how:"recorte sin rejilla",box:b});continue}
    try{res.push(readCard(c,one[0].corners))}catch(e){f.tries.push({how:"error de lectura",err:e.message});Log.add("error","lector","GAL_READ_FAIL","falló la lectura de un cartón detectado",{err:e})}}
  return{cards:res,full,f};
}
/* abrir una foto de la galería de forma robusta (fotos grandes de 50 MP, orientación, HEIC) */
async function decodeFile(f){
  const meta={name:f.name,type:f.type||"(sin tipo)",kb:Math.round(f.size/1024),mod:new Date(f.lastModified).toISOString()},steps=[];
  if(/hei[cf]/i.test(f.type)||/\.hei[cf]$/i.test(f.name))Log.add("warn","galeria","GAL_HEIC",`${f.name}: formato HEIC/HEIF`,meta);
  let el=null,nat=null;
  try{const u=URL.createObjectURL(f);el=new Image();el.src=u;await el.decode();nat=[el.naturalWidth,el.naturalHeight];steps.push("img ok "+nat.join("×"))}catch(e){steps.push("img ✕ "+(e.name||"")+" "+e.message);el=null}
  const MAXS=3200;
  if(nat&&window.createImageBitmap){try{const k=Math.min(1,MAXS/Math.max(...nat)),bm=await createImageBitmap(f,k<1?{resizeWidth:Math.round(nat[0]*k),resizeQuality:"high"}:{});const c=toCanvas(bm,MAXS);bm.close&&bm.close();steps.push("bitmap ok "+c.width+"×"+c.height);return{canvas:c,meta,steps,nat}}catch(e){steps.push("bitmap ✕ "+(e.name||"")+" "+e.message)}}
  if(el){try{const c=toCanvas(el,MAXS);steps.push("canvas ok "+c.width+"×"+c.height);return{canvas:c,meta,steps,nat}}catch(e){steps.push("canvas ✕ "+e.message)}}
  try{const bm=await createImageBitmap(f);const c=toCanvas(bm,MAXS);steps.push("bitmap completo ok");return{canvas:c,meta,steps,nat}}catch(e){steps.push("bitmap completo ✕ "+(e.name||"")+" "+e.message)}
  return{canvas:null,meta,steps,nat};
}
/* procesar imágenes (galería o foto de grupo) con resultado visible por archivo */
async function importItems(items,label){
  let ok=0,rev=0,dup=0,none=0,fail=0;const rowsOut=[],box=$("#lastScan");
  box.innerHTML=`<div class="panel"><h2>${esc(label)}: procesando ${items.length}…</h2></div>`;
  for(const it of items){const end=Log.time();
    if(!it.canvas){fail++;rowsOut.push({n:it.name,cls:"bad",t:"No se pudo abrir la imagen"+(/hei[cf]/i.test((it.meta||{}).type||"")?" (formato HEIC: usa JPG)":"")});
      Log.add("error","galeria","GAL_DECODE_FAIL",`${it.name}: el teléfono no pudo abrir la foto`,{...it.meta,steps:it.steps});continue}
    let out;try{out=await readImage(it.canvas)}catch(e){fail++;rowsOut.push({n:it.name,cls:"bad",t:"Error al analizar: "+e.message});Log.add("error","galeria","GAL_READ_FAIL",`${it.name}: error al analizar`,{err:e,...it.meta});continue}
    if(!out.cards.length){none++;rowsOut.push({n:it.name,cls:"bad",t:"No se encontró ningún cartón en la foto"});
      const k=end("error","galeria","GAL_NO_CARD",`${it.name}: no se encontró la rejilla de ningún cartón`,{...it.meta,steps:it.steps,tries:out.f.tries,diag:out.f.diag});Log.img(out.full,"sin cartón",k);continue}
    const txt=[];for(const rd of out.cards){const s=await storeRead(rd,label);showLast(s,true);if(s.kind==="ok")ok++;else if(s.kind==="review")rev++;else dup++;txt.push(`${s.card.carton||"¿?"} ${s.kind==="ok"?"✓":s.kind==="dup"?"(ya estaba)":"⚠ revisar"}`);
      if(s.kind==="review")Log.img(out.full,"lectura con dudas",null)}
    end("info","galeria","GAL_FILE",`${it.name}: ${out.cards.length} cartón(es)`,{...it.meta,steps:it.steps,tries:out.f.tries,result:txt});
    rowsOut.push({n:it.name,cls:"ok",t:`${out.cards.length} cartón(es): ${txt.join(" · ")}`})}
  const sum=`${ok} guardados${rev?` · ${rev} por revisar`:""}${dup?` · ${dup} repetidos`:""}${none?` · ${none} sin cartón`:""}${fail?` · ${fail} no se abrieron`:""}`;
  const last=box.querySelector(".cardbox");box.innerHTML=`<div class="panel"><h2>${esc(label)} · ${sum}</h2>${rowsOut.map(r=>`<div class="frow ${r.cls}"><b>${esc(r.n)}</b><span>${esc(r.t)}</span></div>`).join("")}
    ${(none||fail)?`<p class="mut small" style="margin:8px 0 0">El motivo detallado y la foto quedan en <b>Bitácora</b>.</p>`:""}</div>`+(last?last.outerHTML:"");
  const ed=box.querySelector("[data-e]");if(ed&&lastShown)ed.onclick=()=>editCard(lastShown);
  toast(`${label}: ${sum}`,4000);if(ok||rev){beep([[880,.08],[1320,.12]]);buzz(80)}else if(none||fail){beep([[330,.2]]);buzz([80,60,80])}
}
let lastShown=null;
function showLast(s,keep){const c=s.card,box=$("#lastScan");lastShown=c;
  const html=`<div class="cardbox ${c.status==="review"?"review":""}"><div class="cardhead"><span>Cartón ${esc(c.carton||"¿?")}</span><span class="ser">Serie ${esc(c.serie)}</span><span class="sp"></span>
   <span class="chip">${s.kind==="dup"?"Ya estaba":c.status==="review"?"⚠ Revisar":"✓ Guardado"}</span><button class="btn sm" data-e>Editar</button></div>${miniHTML(c)}${issuesHTML(c)}</div>`;
  if(keep){const old=box.querySelector(".cardbox");if(old)old.outerHTML=html;else box.insertAdjacentHTML("beforeend",html)}else box.innerHTML=html;
  box.querySelector("[data-e]").onclick=()=>editCard(c)}

/* ================= ESCÁNER EN VIVO ================= */
const Cam=(()=>{
  let stream=null,track=null,run=false,busy=false,timer=null,hist=[],locked=false,lostN=0,lockQuad=null,lockRows=[],lockT=0,fails=0,torch=false;
  let st={frames:0,det:0,ms:0,since:0,lastDet:0,warned:0};
  const video=$("#video"),ov=$("#overlay"),msg=$("#scanMsg"),small=document.createElement("canvas");
  const say=(t,cls)=>{msg.textContent=t;msg.className=cls||""};
  async function start(){
    if(!S.game){toast("Primero crea una partida");return}
    const end=Log.time();
    try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}})}
    catch(e){const den=e.name==="NotAllowedError";say("No pude abrir la cámara: "+(den?"da permiso a la cámara en el navegador":e.message),"warn");Log.add("error","camara",den?"CAM_DENIED":"CAM_ERROR","no se pudo abrir la cámara: "+e.name,{err:e});return}
    track=stream.getVideoTracks()[0];video.srcObject=stream;await video.play().catch(e=>Log.add("warn","camara","CAM_PLAY","video.play falló",{err:e}));
    let cap={};try{cap=track.getCapabilities?track.getCapabilities():{};const adv=[];if(cap.focusMode&&cap.focusMode.includes("continuous"))adv.push({focusMode:"continuous"});if(adv.length)await track.applyConstraints({advanced:adv});
      $("#tTorch").disabled=!cap.torch}catch(e){Log.add("warn","camara","CAM_CAPS","no se pudieron aplicar ajustes de cámara",{err:e})}
    const s=track.getSettings?track.getSettings():{};end("info","camara","CAM_START",`cámara abierta ${s.width||"?"}×${s.height||"?"}`,{settings:s,torch:!!cap.torch,focus:cap.focusMode||null,label:track.label});
    $("#tGroup").disabled=false;$("#scanStart").style.display="none";run=true;hist=[];locked=false;fails=0;st={frames:0,det:0,ms:0,since:Date.now(),lastDet:Date.now(),warned:0};say("Apunta al cartón");loop();
  }
  function stats(){if(!st.frames)return;Log.add("info","camara","CAM_STATS",`${st.frames} cuadros, cartón visible en ${Math.round(100*st.det/st.frames)}%`,{frames:st.frames,det:st.det,msDetect:Math.round(st.ms/st.frames),seg:Math.round((Date.now()-st.since)/1000)})}
  function stop(){if(run){stats();Log.add("info","camara","CAM_STOP","cámara cerrada")}run=false;clearTimeout(timer);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}track=null;torch=false;$("#scanStart").style.display="";$("#tTorch").disabled=true;$("#tGroup").disabled=true;
    const x=ov.getContext("2d");x.clearRect(0,0,ov.width,ov.height)}
  function mapPt(p,vw,vh){const W=ov.clientWidth,H=ov.clientHeight,k=Math.min(W/vw,H/vh);return[(p[0]*vw/small.width)*k+(W-vw*k)/2,(p[1]*vh/small.height)*k+(H-vh*k)/2]}
  function draw(q,color){const x=ov.getContext("2d"),dpr=devicePixelRatio||1;if(ov.width!==ov.clientWidth*dpr){ov.width=ov.clientWidth*dpr;ov.height=ov.clientHeight*dpr}
    x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,ov.width,ov.height);if(!q)return;const vw=video.videoWidth,vh=video.videoHeight,P=q.map(p=>mapPt(p,vw,vh));
    x.lineWidth=4;x.strokeStyle=color;x.fillStyle=color.replace("1)",".14)");x.beginPath();P.forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1]));x.closePath();x.fill();x.stroke()}
  const center=q=>[(q[0][0]+q[1][0]+q[2][0]+q[3][0])/4,(q[0][1]+q[1][1]+q[2][1]+q[3][1])/4];
  function loop(){if(!run)return;timer=setTimeout(tick,110)}
  function tick(){try{
    if(!run)return;if(busy||!video.videoWidth){loop();return}
    const vw=video.videoWidth,vh=video.videoHeight,k=Math.min(1,640/Math.max(vw,vh));small.width=Math.round(vw*k);small.height=Math.round(vh*k);
    small.getContext("2d",{willReadFrequently:true}).drawImage(video,0,0,small.width,small.height);
    const t0=performance.now(),d=BSReader.detect(small,{maxSide:640})[0];st.frames++;st.ms+=performance.now()-t0;if(d){st.det++;st.lastDet=Date.now()}
    if(st.frames%300===0)stats();
    if(!d&&Date.now()-st.lastDet>15000&&Date.now()-st.warned>30000){st.warned=Date.now();Log.add("warn","camara","CAM_NO_DETECT","15 s con la cámara abierta sin encontrar un cartón",{res:[vw,vh]});Log.img(small,"cámara sin cartón",null)}
    const W=small.width;
    if(!d){hist=[];draw(null);if(locked){lostN++;if(lostN>=3){locked=false;fails=0}}if(!locked)say("Apunta al cartón (entero, con el nº de cartón arriba)");loop();return}
    const q=d.corners;
    if(locked){const c0=center(lockQuad),c1=center(q);if(Math.hypot(c0[0]-c1[0],c0[1]-c1[1])>W*.22){locked=false;fails=0}
      else{lostN=0;draw(q,"rgba(46,204,113,1)");
        // cambiaron el cartón sin sacarlo del encuadre: cada ~1,5 s se vuelve a leer y, si los números son otros, es un cartón nuevo
        hist.push(q);if(hist.length>3)hist.shift();const stl=hist.length===3&&hist.every(h=>h.every((p,i)=>Math.hypot(p[0]-q[i][0],p[1]-q[i][1])<W*.012));
        if(stl&&Date.now()-lockT>1500){lockT=Date.now();busy=true;setTimeout(()=>{try{const full=toCanvas(video,1920),fd=BSReader.detect(full)[0];
            if(fd){const rd=readCard(full,fd.corners),fl=rd.grid.flat(),diff=fl.filter((v,i)=>v!==lockRows[i]).length;if(diff>=6&&rd.dub.length<=4){locked=false;busy=false;hist=[];capture(rd,q,full);return}}}catch(e){Log.add("error","lector","CAM_READ_FAIL","error al releer",{err:e})}busy=false;loop()},20);return}
        loop();return}}
    const bw=Math.hypot(q[1][0]-q[0][0],q[1][1]-q[0][1]);if(bw<W*.45){hist=[];draw(q,"rgba(255,167,38,1)");say("Acércate un poco más");loop();return}
    hist.push(q);if(hist.length>3)hist.shift();
    const still=hist.length===3&&hist.every(h=>h.every((p,i)=>Math.hypot(p[0]-q[i][0],p[1]-q[i][1])<W*.012));
    draw(q,still?"rgba(46,204,113,1)":"rgba(255,204,51,1)");
    if(!still){say("Quieto…");loop();return}
    busy=true;say("Leyendo…");
    setTimeout(async()=>{const end=Log.time();let full=null;try{
      full=toCanvas(video,1920);const fd=BSReader.detect(full)[0];
      if(!fd){busy=false;hist=[];loop();return}
      const rd=readCard(full,fd.corners);
      const nIss=Rules.checkGrid(rd.grid).errors.length;
      if((rd.dub.length+nIss>4)&&fails<2){fails++;end("warn","camara","CAM_READ_RETRY",`lectura poco legible (intento ${fails}): ${rd.dub.length} dudas, ${nIss} reglas`,{doubts:rd.doubts,blacks:rd.blacks});
        if(fails===2)Log.img(full,"lectura poco legible",null);say("No se leyó bien: mejora la luz o acércate","warn");hist=[];busy=false;loop();return}
      end("info","camara","CAM_READ",`lectura en vivo (${rd.carton||"¿?"})`,{res:[full.width,full.height],dudas:rd.dub.length});
      busy=false;await capture(rd,q,full);return;
    }catch(e){say("Error al leer: "+e.message,"warn");Log.add("error","lector","CAM_READ_FAIL","error al leer en vivo",{err:e});if(full)Log.img(full,"error de lectura",null)}busy=false;loop()},30);
  }catch(e){Log.add("error","camara","CAM_LOOP","error en el ciclo de la cámara",{err:e});busy=false;loop()}}
  async function capture(rd,q,full){busy=true;try{
      const s=await storeRead(rd,"cámara");showLast(s);locked=true;lockQuad=q;lockRows=rd.grid.flat();lockT=Date.now();lostN=0;fails=0;hist=[];
      if(s.kind==="dup"){say(`Cartón ${s.card.carton} ya estaba guardado`,"warn");buzz(40)}
      else if(s.kind==="ok"){say(`✓ Cartón ${s.card.carton} guardado · ${S.cards.length} en total — pon el siguiente`,"good");beep([[1046,.07],[1568,.1]]);buzz(90)}
      else{say(`⚠ Cartón ${s.card.carton||"¿?"} guardado para revisar — pon el siguiente`,"warn");beep([[660,.12]]);buzz([60,60,60]);if(full)Log.img(full,"por revisar "+(s.card.carton||""),null)}
    }catch(e){say("Error al guardar: "+e.message,"warn");Log.add("error","datos","DB_ERROR","no se pudo guardar el cartón",{err:e})}busy=false;loop()}
  async function group(){
    if(!track)return;busy=true;say("Tomando foto de grupo…");
    try{let img=null,how="video";if(window.ImageCapture){try{const ic=new ImageCapture(track);const blob=await ic.takePhoto();img=await createImageBitmap(blob);how="takePhoto"}catch(e){Log.add("warn","camara","GROUP_PHOTO","takePhoto falló; uso el cuadro del video",{err:e})}}
      const c=img?toCanvas(img,3200):toCanvas(video);Log.add("info","galeria","GROUP",`foto de grupo ${c.width}×${c.height} (${how})`);
      await importItems([{name:"Foto de grupo",canvas:c,meta:{how},steps:[]}],"Foto de grupo");say("Listo. Apunta al siguiente cartón o toma otra foto");
    }catch(e){say("Error: "+e.message,"warn");Log.add("error","galeria","GAL_READ_FAIL","error en foto de grupo",{err:e})}busy=false;locked=false;hist=[]}
  async function setTorch(){if(!track)return;torch=!torch;try{await track.applyConstraints({advanced:[{torch}]});$("#tTorch").classList.toggle("pri",torch);Log.add("info","camara","TORCH",torch?"linterna encendida":"linterna apagada")}catch(e){toast("Esta cámara no permite linterna");Log.add("warn","camara","TORCH","linterna no disponible",{err:e})}}
  return{start,stop,group,setTorch}})();
$("#camStart").onclick=()=>Cam.start();$("#tGroup").onclick=()=>Cam.group();$("#tTorch").onclick=()=>Cam.setTorch();
$("#tFiles").onchange=async e=>{const fs=[...e.target.files];e.target.value="";if(!fs.length){Log.add("info","galeria","GAL_CANCEL","selección de galería cancelada");return}
  Log.add("info","galeria","GAL_PICK",`${fs.length} foto(s) elegidas`,{files:fs.map(f=>({name:f.name,type:f.type,kb:Math.round(f.size/1024)}))});
  toast(`Abriendo ${fs.length} foto(s)…`,8000);const items=[];
  for(const f of fs){const r=await decodeFile(f);items.push({name:f.name,canvas:r.canvas,meta:r.meta,steps:r.steps});if(r.canvas)Log.add("info","galeria","GAL_DECODE",`${f.name}: abierta`,{...r.meta,steps:r.steps})}
  await importItems(items,"Galería")};
render.scan=()=>{renderHeader()};

/* ================= CARTONES ================= */
render.cards=()=>{const C=S.cards.slice().sort((a,b)=>(b.status==="review")-(a.status==="review")||String(a.carton).localeCompare(String(b.carton)));
  const rv=C.filter(c=>c.status==="review").length;$("#cCount").textContent=`${C.length} cartón${C.length===1?"":"es"}`;$("#cSub").textContent=rv?`${rv} por revisar (toca para corregir)`:"Todos verificados";
  $$("#cSeg button").forEach(b=>b.classList.toggle("on",b.dataset.f===S.filter));
  const L=C.filter(c=>S.filter==="all"||c.status==="review");
  $("#cList").innerHTML=L.length?L.map(c=>`<div class="cardbox ${c.status==="review"?"review":""}" data-id="${c.id}"><div class="cardhead"><span>Cartón ${esc(c.carton||"¿?")}</span><span class="ser">Serie ${esc(c.serie||"—")}</span><span class="sp"></span>${c.status==="review"?'<span class="chip" style="color:var(--warn)">⚠ Revisar</span>':""}</div>${miniHTML(c)}${c.status==="review"?issuesHTML(c):""}</div>`).join("")
    :`<div class="empty">${S.filter==="review"?"Nada por revisar 👍":"Aún no hay cartones. Ve a <b>Escanear</b>."}</div>`;
  $$("#cList .cardbox").forEach(el=>el.onclick=()=>editCard(S.cards.find(c=>c.id===el.dataset.id)));renderHeader()};
$$("#cSeg button").forEach(b=>b.onclick=()=>{S.filter=b.dataset.f;render.cards()});
$("#cAdd").onclick=()=>editCard(null);

/* editor de un cartón (corrección o alta manual) — validación EN VIVO con las reglas */
function editCard(card){
  const isNew=!card;card=card||normalizeCard({id:uid(),gameId:S.game.id,carton:"",serie:S.game.serie||"",rows:[[],[],[]],thumb:"",created:Date.now(),status:"review"});
  Log.add("info","editor","OPEN",isNew?"alta manual de cartón":`editar cartón ${card.carton}`,{id:card.id,status:card.status});
  const d=$("#dlg"),dub=new Set(card.dub||[]),G=card.grid;let cells="";
  const heads=["1–9","10","20","30","40","50","60","70","80–90"].map(h=>`<div class="eh">${h}</div>`).join("");
  for(let r=0;r<3;r++)for(let c=0;c<9;c++){const v=G[r][c],i=r*9+c;cells+=`<input inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" data-i="${i}" data-r="${r}" data-c="${c}" value="${v==null||v===-1?"":v}" placeholder="${v===-1?"?":""}" class="${v==null?"blk":dub.has(i)||v===-1?"dub":""}">`}
  d.innerHTML=`<h2 style="margin:0 0 10px">${isNew?"Agregar cartón":"Cartón "+esc(card.carton||"¿?")}</h2>
    ${card.thumb?`<img class="thumb" src="${card.thumb}" alt="foto del cartón">`:""}
    <div class="row" style="margin-top:10px"><div class="field grow" style="margin:0"><label>Nº de cartón</label><input id="eC" inputmode="numeric" maxlength="4" value="${esc(card.carton)}"></div><div class="field grow" style="margin:0"><label>Serie</label><input id="eS" inputmode="numeric" maxlength="4" value="${esc(card.serie)}"></div></div>
    <p class="mut small" style="margin:10px 0 4px">Cada columna es una decena. 5 números por fila, 15 en total, sin repetir, del 1 al 90. Amarillo = el lector dudó.</p>
    <div class="edgrid">${heads}${cells}</div><div id="eRows" class="erows"></div><div class="msgs bad" id="eM"></div><div class="msgs" id="eW"></div>
    <div class="row" style="margin-top:6px">${isNew?"":'<button class="btn sm bad" id="eDel">Borrar</button>'}<span class="grow"></span><button class="btn sm" id="eX">Cancelar</button><button class="btn sm ok" id="eOk">Guardar ✓</button></div>`;
  const ins=[...d.querySelectorAll(".edgrid input")],eC=d.querySelector("#eC"),eS=d.querySelector("#eS"),ok=d.querySelector("#eOk");
  let last=null,warnOk=false;
  const gridNow=()=>{const g=[...Array(3)].map(()=>Array(9).fill(null));ins.forEach(i=>{if(i.value!=="")g[+i.dataset.r][+i.dataset.c]=i.value});return g};
  function validate(){const g=gridNow(),carton=eC.value.trim(),serie=eS.value.trim();
    const res=Rules.checkCard({id:card.id,carton:carton?pad4(carton):"",serie:/^\d{1,4}$/.test(serie)?pad4(serie):serie,grid:g},S.cards);
    ins.forEach(i=>{const m=res.cellErr.get(+i.dataset.i);i.classList.toggle("bad",!!m);i.title=m||"";i.classList.toggle("blk",!i.value&&!i.placeholder)});
    eC.classList.toggle("bad",res.errors.some(e=>e.code==="R08"||e.code==="R10"||e.code==="R11"));eS.classList.toggle("bad",res.errors.some(e=>e.code==="R09"));
    const counts=[0,1,2].map(r=>g[r].filter(v=>v!=null).length);
    d.querySelector("#eRows").innerHTML=counts.map((n,r)=>`<span class="${n===5?"ok":"bad"}">Fila ${r+1}: ${n}/5</span>`).join("")+`<span class="${counts.reduce((a,b)=>a+b,0)===15?"ok":"bad"}">Total ${counts.reduce((a,b)=>a+b,0)}/15</span>`;
    const uniq=[...new Map(res.errors.map(e=>[e.code+e.msg,e])).values()];
    d.querySelector("#eM").innerHTML=uniq.slice(0,6).map(e=>`✕ ${esc(e.msg)}`).join("<br>")+(uniq.length>6?`<br>… y ${uniq.length-6} más`:"");
    d.querySelector("#eW").innerHTML=res.errors.length?"":res.warnings.map(e=>`ⓘ ${esc(e.msg)}`).join("<br>");
    ok.classList.toggle("off",!!res.errors.length);ok.textContent=res.errors.length?`Corrige ${uniq.length} error${uniq.length>1?"es":""}`:res.warnings.length&&!warnOk?"Guardar (revisé el aviso)":"Guardar ✓";
    last={res,g,carton,serie};return res}
  ins.forEach(i=>{
    i.oninput=()=>{const raw=i.value;let v=raw.replace(/\D/g,"").slice(0,2);
      if(v.startsWith("0")){toast(v==="0"||v==="00"?"El 0 no existe: los números van del 1 al 90":`Escribe ${+v} (sin el 0)`);Log.add("warn","reglas",v==="0"||v==="00"?"R01":"R13",`se intentó escribir "${v}"`,{cell:i.dataset.i});v=""}
      if(v.length===2&&+v>90){toast(`${v} no existe: el máximo es 90`);Log.add("warn","reglas","R01",`se intentó escribir ${v}`,{cell:i.dataset.i})}
      i.value=v;i.placeholder="";i.classList.remove("dub");validate();
      if(v.length===2&&!i.classList.contains("bad")){const n=ins[ins.indexOf(i)+1];if(n)n.focus()}};
    i.onfocus=()=>i.select()});
  eC.oninput=()=>{eC.value=eC.value.replace(/\D/g,"").slice(0,4);validate()};eS.oninput=()=>{eS.value=eS.value.replace(/\D/g,"").slice(0,4);validate()};
  d.querySelector("#eX").onclick=()=>{Log.add("info","editor","CANCEL","edición cancelada",{id:card.id});d.close()};
  if(!isNew){const bd=d.querySelector("#eDel");bd.onclick=async()=>{if(!bd.dataset.sure){bd.dataset.sure=1;bd.textContent="¿Seguro? Toca otra vez";return}
    await DB.del("cards",card.id);S.cards=S.cards.filter(c=>c.id!==card.id);Log.add("info","cartones","DELETE",`cartón ${card.carton} borrado`,{id:card.id});d.close();toast("Cartón borrado");renderAll()}}
  ok.onclick=async()=>{const res=validate();
    if(res.errors.length){Log.add("warn","reglas","RULE_BLOCK",`no se guardó: ${res.errors.length} regla(s) incumplida(s)`,{codes:[...new Set(res.errors.map(e=>e.code))],errors:res.errors.map(e=>e.msg).slice(0,10)});
      d.querySelector("#eM").classList.remove("shake");void d.querySelector("#eM").offsetWidth;d.querySelector("#eM").classList.add("shake");buzz(60);return}
    if(res.warnings.length&&!warnOk){warnOk=true;validate();return}
    const grid=last.g.map(r=>r.map(v=>v==null?null:+v));
    Object.assign(card,{carton:pad4(last.carton),serie:pad4(last.serie),grid});applyRules(card,[]);
    try{await DB.put("cards",card)}catch(e){toast("No se pudo guardar");return}
    if(isNew)S.cards.push(card);Log.add("info","editor","SAVE",`cartón ${card.carton} ${isNew?"agregado":"corregido"} (${card.status})`,{id:card.id,warns:card.warns});
    d.close();toast(`Cartón ${card.carton} guardado`);renderAll()};
  d.onclose=null;d.showModal();validate();
}

/* ================= JUGAR ================= */
/* una fila solo cuenta para LÍNEA si tiene sus 5 números válidos; TABLA LLENA exige los 15 */
function evalCards(){const C=called(),out=[];
  for(const c of S.cards){const miss=c.rows.map(r=>r.filter(v=>!C.has(v)));const full=c.rows.map(r=>r.length===5);
    const lens=miss.map((m,i)=>full[i]?m.length:99);const best=Math.min(...lens);const total=c.rows.flat().length===15?miss.reduce((a,m)=>a+m.length,0):99;
    out.push({c,miss,best,bestRow:lens.indexOf(best),total,complete:c.rows.flat().length===15})}
  return out}
function buildBoard(){const B=$("#board");let h="";
  for(let t=0;t<9;t++)for(let u=0;u<10;u++){const v=t*10+u;h+=v===0?'<button class="ph" tabindex="-1"></button>':`<button data-n="${v}">${v}</button>`}
  h+='<button data-n="90">90</button><button class="util undo" id="bUndo" style="grid-column:span 5">↶ Deshacer</button><button class="util" id="bMore" style="grid-column:span 4">Más…</button>';
  B.innerHTML=h;
  B.onclick=e=>{const b=e.target.closest("button[data-n]");if(!b)return;toggleBall(+b.dataset.n)};
  $("#bUndo").onclick=()=>{const g=S.game;if(!g.draws.length)return;const v=g.draws.pop();Log.add("info","juego","UNDO",`deshacer bola ${v}`,{n:g.draws.length});afterChange();toast("Quitada la bola "+v)};
  $("#bMore").onclick=moreMenu;
  $$("#phase button").forEach(b=>b.onclick=()=>{S.game.phase=b.dataset.p;Log.add("info","juego","PHASE","fase: "+b.dataset.p);saveGame();render.play()});
}
function toggleBall(v){const g=S.game,i=g.draws.indexOf(v);
  if(i>=0){g.draws.splice(i,1);Log.add("info","juego","UNMARK",`bola ${v} desmarcada`,{n:g.draws.length});toast(`Bola ${v} desmarcada`);afterChange();return}
  const bad=Rules.checkBall(v,g.draws);if(bad){Log.add("warn","reglas","BALL_REJECT",bad.msg,{code:bad.code});toast(bad.msg);return}
  g.draws.push(v);Log.add("info","juego","BALL",`bola ${v}`,{n:g.draws.length});afterChange(v)}
function afterChange(newBall){
  const g=S.game;saveGame();const ev=evalCards();
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
  Log.add("info","juego","ALERT",`${kind==="full"?"TABLA LLENA":"LÍNEA"}: ${wins.map(e=>e.c.carton+"/"+e.c.serie).join(", ")}`,{bolas:S.game.draws.length,review:wins.filter(e=>e.c.status==="review").length});
  $("#aT").innerHTML=kind==="full"?"¡BINGO!<small>TABLA LLENA</small>":"¡LÍNEA!";
  $("#aWho").innerHTML=`Cartón ${esc(w.c.carton||"¿?")} · <span class="ser">Serie ${esc(w.c.serie||"—")}</span>${w.c.status==="review"?' <span class="chip" style="color:var(--warn)">⚠ cartón sin revisar: compáralo con el físico</span>':""}`;
  $("#aCard").innerHTML=miniHTML(w.c,{called:C});
  $("#aMore").textContent=(kind==="linea"?`Fila ${w.bestRow+1} completa. `:"")+(wins.length>1?`También: ${wins.slice(1).map(e=>"cartón "+e.c.carton).join(", ")}`:"");
  const acts=$("#aActs");acts.innerHTML=(kind==="linea"?'<button class="btn pri" data-a="full">Cobrado · seguir a tabla llena</button>':"")+'<button class="btn" data-a="x">Cerrar</button>';
  acts.querySelectorAll("button").forEach(b=>b.onclick=()=>{if(b.dataset.a==="full"){S.game.phase="full";Log.add("info","juego","PHASE","fase: full (desde alerta)");saveGame();render.play()}A.className=""});
  beep(kind==="full"?[[784,.15],[988,.15],[1175,.15],[1568,.4],[1175,.15],[1568,.5]]:[[988,.14],[1319,.14],[1568,.35],[1319,.14],[1568,.4]]);
  buzz(kind==="full"?[400,120,400,120,400,120,800]:[300,120,300,120,600]);
}
async function moreMenu(){
  const v=await ask(`<h2 style="margin-top:0">Opciones del juego</h2><p class="mut small">${S.game.draws.length} bolas marcadas.</p>
    <div class="field"><label>Pegar o escribir varias bolas (separadas por espacio o coma)</label><input id="mBulk" inputmode="numeric" placeholder="Ej.: 5 18 44 90"></div>`,
    [{t:"Reiniciar bolas",v:"reset",cls:"bad"},{t:"Cerrar",v:null},{t:"Agregar",v:"__input",cls:"pri"}]);
  if(v==="reset"){if(await ask(`<h2 style="margin-top:0">¿Borrar todas las bolas?</h2><p>Los cartones no se tocan.</p>`,[{t:"Cancelar",v:false},{t:"Borrar bolas",v:true,cls:"bad"}])===true){Log.add("info","juego","RESET",`bolas reiniciadas (${S.game.draws.length})`);S.game.draws=[];S.game.alerted={linea:[],full:[]};S.game.phase="linea";afterChange()}return}
  if(typeof v==="string"&&v.trim()){const p=Rules.parseBalls(v,S.game.draws);let last=null;for(const n of p.ok){S.game.draws.push(n);last=n}
    Log.add(p.bad.length?"warn":"info","juego","BULK",`bolas en bloque: ${p.ok.length} aceptadas${p.bad.length?`, ${p.bad.length} rechazadas`:""}`,{texto:v,ok:p.ok,rechazadas:p.bad});
    if(p.bad.length){Log.add("warn","reglas","BALL_REJECT",p.bad.map(b=>b.msg).join("; "));await ask(`<h2 style="margin-top:0">Algunas bolas no se agregaron</h2><p>${p.bad.map(b=>"✕ "+esc(b.msg)).join("<br>")}</p>${p.ok.length?`<p class="mut">Agregadas: ${p.ok.join(", ")}</p>`:""}`,[{t:"Entendido",v:null,cls:"pri"}])}
    if(last!=null)afterChange(last)}
}
render.play=(newBall)=>{
  const g=S.game;if(!$("#board").children.length)buildBoard();
  $$("#phase button").forEach(b=>b.classList.toggle("on",b.dataset.p===(g.phase||"linea")));
  const C=called(),ev=evalCards(),phase=g.phase||"linea";
  const rv=S.cards.filter(c=>c.status==="review").length,ban=$("#playWarn");ban.hidden=!rv;ban.innerHTML=rv?`⚠ ${rv} cartón(es) por revisar: sus alertas pueden no ser exactas. <u>Revisar</u>`:"";
  const hot=new Set();for(const e of ev){if(phase==="linea"){e.miss.forEach((m,i)=>{if(e.c.rows[i].length===5&&m.length===1)hot.add(m[0])})}else if(e.total===1)hot.add(e.miss.flat()[0])}
  $$("#board button[data-n]").forEach(b=>{const n=+b.dataset.n;b.classList.toggle("on",C.has(n));b.classList.toggle("hot",hot.has(n))});
  if(newBall){const b=$(`#board button[data-n="${newBall}"]`);if(b){b.classList.remove("flash");void b.offsetWidth;b.classList.add("flash")}}
  const last=g.draws[g.draws.length-1],bb=$("#bigBall");bb.className="bigball"+(last?"":" empty");bb.textContent=last||"—";
  $("#prevBalls").innerHTML=g.draws.slice(-7,-1).reverse().map(v=>`<span>${v}</span>`).join("");$("#ballCnt").textContent=g.draws.length;
  let list=phase==="linea"?ev.slice().sort((a,b)=>a.best-b.best||a.total-b.total):ev.slice().sort((a,b)=>a.total-b.total||a.best-b.best);
  list=list.slice(0,10);
  const N=$("#near");
  if(!S.cards.length){N.innerHTML='<div class="empty">No hay cartones en esta partida. Ve a <b>Escanear</b>.</div>';return}
  N.innerHTML=`<h3>${phase==="linea"?"Más cerca de LÍNEA":"Más cerca de TABLA LLENA"} <span class="mut small">· ${S.cards.length} cartones</span></h3>`+list.map(e=>{
    const k=phase==="linea"?e.best:e.total,m=phase==="linea"?(e.miss[e.bestRow]||[]):e.miss.flat();
    const cls=k===0?"win":k===1?"one":"";
    const miss=k>=99?'<span class="mut" style="background:none;font-weight:500">cartón incompleto: revísalo</span>':k===0?'<span style="background:#14532d;color:#86efac">¡COMPLETO!</span>':(m.length<=8?m.map(v=>`<span>${v}</span>`).join(""):`<span class="mut" style="background:none;font-weight:500">aún lejos</span>`);
    return`<div class="nitem ${cls}" data-id="${e.c.id}"><div class="k">${esc(e.c.carton||"¿?")}${e.c.status==="review"?" ⚠":""}<small>S ${esc(e.c.serie||"—")}</small></div><div class="miss">${miss}</div><div class="n">${k>=99?"":`${phase==="linea"?`fila ${e.bestRow+1}<br>`:""}falta${k===1?"":"n"} ${k}`}</div></div>`}).join("");
  N.querySelectorAll(".nitem").forEach(el=>el.onclick=()=>{const c=S.cards.find(x=>x.id===el.dataset.id);const e=ev.find(x=>x.c.id===c.id);
    ask(`<h2 style="margin-top:0">Cartón ${esc(c.carton)} · <span style="color:#ff6b6b">Serie ${esc(c.serie)}</span></h2>${miniHTML(c,{called:C,need:new Set(phase==="linea"?(e.miss[e.bestRow]||[]):e.miss.flat())})}`,[{t:"Cerrar",v:null}])});
  renderHeader();
};
$("#playWarn").onclick=()=>{S.filter="review";go("cards")};

/* ================= arranque ================= */
(async()=>{
  try{const t=await (await fetch("tpl.json")).json();BSReader.setTemplates(t);const extra=await DB.getMeta("userTpl");if(extra)BSReader.addTemplates(extra);Log.add("info","lector","TPL",`plantillas cargadas: ${BSReader.templates}`)}
  catch(e){toast("No se cargaron las plantillas del lector");Log.add("error","lector","TPL_FAIL","no se cargaron las plantillas del lector",{err:e})}
  try{await loadAll()}catch(e){Log.add("error","datos","DB_ERROR","no se pudieron cargar los datos",{err:e})}
  renderAll();go(S.game?(S.cards.length?"play":"scan"):"games");
  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(e=>Log.add("warn","app","SW","no se registró el modo sin internet",{err:e}));
})();
