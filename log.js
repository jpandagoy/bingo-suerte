/* Bingo de la Suerte · BITÁCORA (registro de cada interacción y de cada fallo).
   Independiente del resto: base de datos propia ("bingo-suerte-log"), y TODO va dentro de try/catch:
   si la bitácora fallara, la app sigue funcionando igual. Se exporta en JSON para analizarla después. */
const Log=(function(){
"use strict";
const MAXLOG=4000,MAXIMG=30,SID=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
let db=null,queue=[],flushT=null,mem=[],seq=0,unseenErr=0;
const MOD={app:"App",partidas:"Partidas",camara:"Cámara",galeria:"Galería / foto de grupo",lector:"Lector de cartones",reglas:"Reglas de negocio",editor:"Editor de cartón",cartones:"Cartones",juego:"Juego",bitacora:"Bitácora",datos:"Base de datos"};
/* qué significa cada evento de fallo y qué hacer (para el panel de diagnóstico) */
const KB={
  GAL_DECODE_FAIL:{c:"El teléfono no pudo abrir la foto.",f:"Si el tipo es HEIC/HEIF: en la cámara del OnePlus desactiva «Formato HEIF» (o comparte la foto como JPG). Si es una foto de 50 MP, usa la resolución normal (12 MP)."},
  GAL_HEIC:{c:"La foto está en formato HEIC/HEIF, que Chrome no abre.",f:"Cámara → Ajustes → Formato de foto: JPG. O usa el escáner en vivo."},
  GAL_NO_CARD:{c:"En la foto no se encontró la rejilla de un cartón.",f:"El cartón debe verse entero, con las 4 esquinas, ocupando buena parte de la foto, sin reflejos fuertes. Revisa la imagen guardada en esta bitácora."},
  GAL_READ_FAIL:{c:"Se encontró el cartón pero falló la lectura.",f:"Revisa el detalle técnico; envíame la bitácora."},
  READ_REVIEW:{c:"El cartón se guardó, pero con dudas o reglas incumplidas.",f:"Abre Cartones → Por revisar y corrige lo marcado en amarillo/rojo."},
  CAM_DENIED:{c:"El navegador no dio permiso a la cámara.",f:"Chrome → candado de la dirección → Permisos → Cámara: Permitir."},
  CAM_ERROR:{c:"La cámara no se pudo abrir.",f:"Cierra otras apps que usen la cámara y vuelve a intentar."},
  CAM_NO_DETECT:{c:"La cámara estuvo encendida un rato sin encontrar un cartón.",f:"Más luz, cartón entero en pantalla y sobre fondo liso."},
  CAM_READ_RETRY:{c:"La foto del cartón salió poco legible y se reintentó.",f:"Acerca un poco el teléfono, evita sombras y reflejos."},
  RULE_BLOCK:{c:"Se intentó guardar un cartón que incumple las reglas.",f:"El editor indica qué casilla y qué regla."},
  BALL_REJECT:{c:"Se intentó cantar una bola inválida o repetida.",f:"Solo 1 a 90 y cada bola una vez."},
  JS_ERROR:{c:"Error interno de la app.",f:"Envíame la bitácora: incluye dónde ocurrió (pila del error)."},
  DB_ERROR:{c:"No se pudo guardar en la memoria del teléfono.",f:"Puede faltar espacio. Exporta una copia y libera espacio."},
  IMPORT_INVALID:{c:"La copia importada traía cartones que incumplen las reglas.",f:"Quedaron como «Por revisar»."},
};
function open(){if(db)return Promise.resolve(db);return new Promise((res,rej)=>{try{const r=indexedDB.open("bingo-suerte-log",1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore("log",{keyPath:"k"});d.createObjectStore("img",{keyPath:"k"})};
  r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)}catch(e){rej(e)}})}
function safe(o,depth){try{return JSON.parse(JSON.stringify(o,(k,v)=>v instanceof Error?{name:v.name,message:v.message,stack:String(v.stack||"").split("\n").slice(0,6).join("\n")}:typeof v==="number"&&!Number.isFinite(v)?String(v):v))}catch(e){return String(o)}}
/* add(nivel, módulo, evento, mensaje, datos) */
function add(lvl,mod,ev,msg,data){try{
  const e={k:Date.now()*1000+(seq++%1000),t:new Date().toISOString(),sid:SID,lvl,mod,ev,msg:String(msg||""),data:data==null?undefined:safe(data)};
  mem.push(e);if(mem.length>600)mem.shift();queue.push(e);if(lvl==="error"){unseenErr++;badge()}
  clearTimeout(flushT);flushT=setTimeout(flush,lvl==="error"?50:800);
  if(document.querySelector("#v-log.on"))render();
  return e.k}catch(err){return null}}
async function flush(){try{if(!queue.length)return;const d=await open(),items=queue.splice(0);await new Promise(res=>{const tx=d.transaction("log","readwrite"),s=tx.objectStore("log");items.forEach(i=>s.put(i));tx.oncomplete=res;tx.onerror=res});prune()}catch(e){}}
let pruneN=0;async function prune(){try{if(++pruneN%20)return;const d=await open();const n=await new Promise(res=>{const r=d.transaction("log").objectStore("log").count();r.onsuccess=()=>res(r.result);r.onerror=()=>res(0)});
  if(n>MAXLOG){await new Promise(res=>{const tx=d.transaction("log","readwrite"),c=tx.objectStore("log").openCursor();let k=n-MAXLOG;c.onsuccess=()=>{const cu=c.result;if(cu&&k-->0){cu.delete();cu.continue()}};tx.oncomplete=res;tx.onerror=res})}}catch(e){}}
/* guarda una imagen reducida (para ver después por qué falló una lectura) */
async function img(src,tag,refK){try{const w=src.videoWidth||src.naturalWidth||src.width,h=src.videoHeight||src.naturalHeight||src.height;if(!w||!h)return;
  const k=Math.min(1,900/Math.max(w,h)),c=document.createElement("canvas");c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext("2d").drawImage(src,0,0,c.width,c.height);
  const url=c.toDataURL("image/jpeg",.7),d=await open(),rec={k:Date.now()*1000+(seq++%1000),t:new Date().toISOString(),sid:SID,tag,ref:refK||null,url,w,h};
  await new Promise(res=>{const tx=d.transaction("img","readwrite");tx.objectStore("img").put(rec);tx.oncomplete=res;tx.onerror=res});
  const all=await getAll("img");if(all.length>MAXIMG){const tx=d.transaction("img","readwrite"),s=tx.objectStore("img");all.slice(0,all.length-MAXIMG).forEach(r=>s.delete(r.k))}
}catch(e){}}
async function getAll(st){try{const d=await open();return await new Promise(res=>{const r=d.transaction(st).objectStore(st).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>res([])})}catch(e){return[]}}
async function clearAll(){try{await flush();const d=await open();await new Promise(res=>{const tx=d.transaction(["log","img"],"readwrite");tx.objectStore("log").clear();tx.objectStore("img").clear();tx.oncomplete=res;tx.onerror=res});mem=[];unseenErr=0;badge()}catch(e){}}
/* medir duración: const end=Log.time(); … end("mod","EV","msg",datos) */
function time(){const t0=performance.now();return(lvl,mod,ev,msg,data)=>add(lvl,mod,ev,msg,Object.assign({ms:Math.round(performance.now()-t0)},data||{}))}
function device(){try{return{app:typeof APPV!=="undefined"?APPV:"?",ua:navigator.userAgent,lang:navigator.language,screen:`${screen.width}×${screen.height} @${devicePixelRatio}`,mem:navigator.deviceMemory||null,cpu:navigator.hardwareConcurrency||null,
  standalone:matchMedia("(display-mode: standalone)").matches,online:navigator.onLine,sw:!!(navigator.serviceWorker&&navigator.serviceWorker.controller),url:location.href}}catch(e){return{}}}
/* errores no controlados de toda la app */
window.addEventListener("error",e=>{add("error","app","JS_ERROR",e.message||"error",{src:(e.filename||"").split("/").pop(),line:e.lineno,col:e.colno,stack:e.error&&String(e.error.stack||"").split("\n").slice(0,8).join("\n")})});
window.addEventListener("unhandledrejection",e=>{const r=e.reason;add("error","app","JS_ERROR","Promesa rechazada: "+(r&&r.message||r),{stack:r&&String(r.stack||"").split("\n").slice(0,8).join("\n")})});
document.addEventListener("visibilitychange",()=>{add("info","app","VISIBILITY",document.visibilityState);if(document.visibilityState==="hidden")flush()});
window.addEventListener("online",()=>add("info","app","NET","con internet"));window.addEventListener("offline",()=>add("warn","app","NET","sin internet"));

/* ===================== vista ===================== */
const F={lvl:"all",mod:"all",q:"",sess:"all"};let renderT=null;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function badge(){try{const b=document.getElementById("logBadge");if(b){b.hidden=!unseenErr;b.textContent=unseenErr>99?"99+":unseenErr}}catch(e){}}
async function all(){await flush();return getAll("log")}
function render(){clearTimeout(renderT);renderT=setTimeout(doRender,120)}
async function doRender(){try{
  const V=document.getElementById("v-log");if(!V)return;unseenErr=0;badge();
  const L=(await all()).sort((a,b)=>b.k-a.k),imgs=await getAll("img"),imgBy=new Map(imgs.filter(i=>i.ref).map(i=>[i.ref,i]));
  const scope=F.sess==="this"?L.filter(e=>e.sid===SID):L;
  // diagnóstico: fallos agrupados por módulo y evento
  const fails=scope.filter(e=>e.lvl!=="info"),grp=new Map();for(const e of fails){const k=e.mod+"|"+e.ev;if(!grp.has(k))grp.set(k,{mod:e.mod,ev:e.ev,lvl:e.lvl,n:0,last:e});const g=grp.get(k);g.n++;if(e.lvl==="error")g.lvl="error"}
  const groups=[...grp.values()].sort((a,b)=>(b.lvl==="error")-(a.lvl==="error")||b.n-a.n);
  const byMod={};for(const e of scope){byMod[e.mod]=byMod[e.mod]||{i:0,w:0,e:0};byMod[e.mod][e.lvl==="error"?"e":e.lvl==="warn"?"w":"i"]++}
  const list=scope.filter(e=>(F.lvl==="all"||(F.lvl==="fail"?e.lvl!=="info":e.lvl===F.lvl))&&(F.mod==="all"||e.mod===F.mod)&&(!F.q||(e.msg+" "+e.ev+" "+JSON.stringify(e.data||"")).toLowerCase().includes(F.q.toLowerCase()))).slice(0,300);
  V.innerHTML=`
  <div class="panel"><h2>Diagnóstico <span class="mut small">· ${F.sess==="this"?"esta sesión":"todo el historial"}</span></h2>
    <div class="seg" id="lgSess"><button data-s="this" class="${F.sess==="this"?"on":""}">Esta sesión</button><button data-s="all" class="${F.sess==="all"?"on":""}">Todo</button></div>
    <div class="lgmods">${Object.keys(MOD).filter(m=>byMod[m]).map(m=>{const b=byMod[m];return`<button class="lgmod ${b.e?"e":b.w?"w":"ok"}" data-m="${m}"><b>${esc(MOD[m])}</b><span>${b.e?`${b.e} error${b.e>1?"es":""}`:b.w?`${b.w} aviso${b.w>1?"s":""}`:"sin fallos"}</span></button>`}).join("")||'<span class="mut">Sin registros todavía.</span>'}</div>
    ${groups.length?`<h3 class="lgh">Qué falló y por qué</h3>`+groups.slice(0,12).map(g=>{const kb=KB[g.ev]||null;return`<div class="lgfail ${g.lvl}"><div class="row"><b class="grow">${esc(MOD[g.mod]||g.mod)} · ${esc(g.ev)}</b><span class="chip">${g.n}×</span></div>
      <div>${esc(g.last.msg)}</div>${kb?`<div class="mut small"><b>Causa probable:</b> ${esc(kb.c)}<br><b>Qué hacer:</b> ${esc(kb.f)}</div>`:""}<div class="mut small">Último: ${new Date(g.last.t).toLocaleString("es-EC")}</div></div>`}).join(""):'<p class="mut small" style="margin:8px 0 0">Sin fallos registrados 👍</p>'}
  </div>
  <div class="panel"><h2>Enviar a soporte</h2><p class="mut small" style="margin:0 0 10px">Al terminar la jornada, comparte o descarga la bitácora (incluye las fotos de las lecturas fallidas) y envíamela para analizarla.</p>
    <div class="row"><button class="btn sm pri" id="lgShare">Compartir</button><button class="btn sm" id="lgDown">Descargar</button><button class="btn sm" id="lgCopy">Copiar resumen</button><span class="grow"></span><button class="btn sm bad" id="lgClear">Borrar</button></div>
    <p class="mut small" style="margin:8px 0 0">${L.length} registros · ${imgs.length} imágenes · sesión ${SID}</p></div>
  <div class="panel"><h2>Registro detallado</h2>
    <div class="seg" id="lgLvl">${[["all","Todo"],["fail","Fallos"],["error","Errores"],["warn","Avisos"]].map(([k,t])=>`<button data-l="${k}" class="${F.lvl===k?"on":""}">${t}</button>`).join("")}</div>
    <div class="row" style="margin-bottom:8px"><select id="lgMod" class="lgsel"><option value="all">Todas las secciones</option>${Object.entries(MOD).map(([k,v])=>`<option value="${k}" ${F.mod===k?"selected":""}>${esc(v)}</option>`).join("")}</select><input id="lgQ" class="lgsel grow" placeholder="Buscar…" value="${esc(F.q)}"></div>
    <div id="lgList">${list.length?list.map(e=>{const im=imgBy.get(e.k);return`<details class="lgrow ${e.lvl}"><summary><span class="lgt">${e.t.slice(11,19)}</span><span class="lgm">${esc(MOD[e.mod]||e.mod)}</span><span class="lgmsg">${esc(e.msg||e.ev)}</span></summary>
      <div class="lgd"><div class="mut small">${esc(e.ev)} · ${e.t} · ${e.lvl}${e.sid!==SID?" · otra sesión":""}</div>${e.data?`<pre>${esc(JSON.stringify(e.data,null,1))}</pre>`:""}${im?`<img src="${im.url}" alt="imagen del fallo" class="lgimg">`:""}</div></details>`}).join(""):'<div class="empty">Nada con estos filtros.</div>'}</div>
  </div>`;
  V.querySelectorAll("#lgSess button").forEach(b=>b.onclick=()=>{F.sess=b.dataset.s;render()});
  V.querySelectorAll("#lgLvl button").forEach(b=>b.onclick=()=>{F.lvl=b.dataset.l;render()});
  V.querySelectorAll(".lgmod").forEach(b=>b.onclick=()=>{F.mod=b.dataset.m;F.lvl="all";render()});
  V.querySelector("#lgMod").onchange=e=>{F.mod=e.target.value;render()};
  const q=V.querySelector("#lgQ");q.onchange=()=>{F.q=q.value;render()};
  V.querySelector("#lgShare").onclick=()=>exportLog(true);V.querySelector("#lgDown").onclick=()=>exportLog(false);
  V.querySelector("#lgCopy").onclick=async()=>{const t=summaryText(scope,groups);try{await navigator.clipboard.writeText(t);note("Resumen copiado")}catch(e){note("No se pudo copiar")}};
  const bc=V.querySelector("#lgClear");bc.onclick=async()=>{if(!bc.dataset.sure){bc.dataset.sure=1;bc.textContent="¿Seguro? Toca otra vez";return}await clearAll();add("info","bitacora","CLEAR","bitácora borrada por el usuario");render()};
}catch(e){try{document.getElementById("v-log").innerHTML='<div class="empty">No se pudo mostrar la bitácora: '+esc(e.message)+'</div>'}catch(_){}}}
function note(m){try{const t=document.getElementById("toast");t.textContent=m;t.classList.add("on");setTimeout(()=>t.classList.remove("on"),2000)}catch(e){}}
function summaryText(scope,groups){const lines=[`Bitácora Bingo de la Suerte · ${new Date().toLocaleString("es-EC")} · ${typeof APPV!=="undefined"?APPV:""}`,`${scope.length} registros`];
  for(const g of groups)lines.push(`- [${g.lvl}] ${MOD[g.mod]||g.mod} · ${g.ev} ×${g.n}: ${g.last.msg}`);return lines.join("\n")}
async function exportLog(share){try{
  const logs=(await all()).sort((a,b)=>a.k-b.k),imgs=await getAll("img");
  const data={app:"bingo-suerte-bitacora",v:typeof APPV!=="undefined"?APPV:"?",exportedAt:new Date().toISOString(),device:device(),session:SID,rules:typeof Rules!=="undefined"?Rules.CATALOG:null,logs,images:imgs};
  const name=`bitacora-bingo-${new Date().toISOString().slice(0,16).replace(/[:T]/g,"-")}.json`,blob=new Blob([JSON.stringify(data)],{type:"application/json"});
  add("info","bitacora","EXPORT",`bitácora exportada (${logs.length} registros, ${imgs.length} imágenes)`,{share,kb:Math.round(blob.size/1024)});
  if(share&&navigator.canShare){const f=new File([blob],name,{type:"application/json"});if(navigator.canShare({files:[f]})){try{await navigator.share({files:[f],title:"Bitácora Bingo de la Suerte"});return}catch(e){if(e.name==="AbortError")return}}}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();note("Bitácora descargada");
}catch(e){note("No se pudo exportar: "+e.message)}}
add("info","app","START","app abierta",device());
return{add,img,time,render,flush,device,SID,MOD};
})();
