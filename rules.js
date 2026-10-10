/* Bingo de la Suerte · REGLAS DE NEGOCIO (una sola fuente de verdad).
   Todo lo que entra a la app —escáner, galería, foto de grupo, edición manual, copia importada, bolas cantadas—
   pasa por aquí. Si una regla "error" falla, el cartón NO se da por bueno (queda "Por revisar") y el editor NO deja guardar. */
const Rules=(function(){
"use strict";
const MIN=1,MAX=90,ROWS=3,COLS=9,PER_ROW=5,TOTAL=15;
const colOf=v=>v>=90?8:Math.floor(v/10);                 // columna (decena) a la que pertenece un número
const colRange=c=>c===0?[1,9]:c===8?[80,90]:[c*10,c*10+9]; // rango permitido por columna
const rangeTxt=c=>{const [a,b]=colRange(c);return`${a}–${b}`};
const isNum=v=>Number.isInteger(v)&&v>=MIN&&v<=MAX;
/* Catálogo: código → regla (se muestra en la app y en la bitácora) */
const CATALOG={
  R01:{lvl:"error",t:"Solo existen números del 1 al 90 (no 0, 00, ni 91 en adelante)"},
  R02:{lvl:"error",t:"Cada número va en la columna de su decena (1–9, 10–19 … 80–90)"},
  R03:{lvl:"error",t:"Un número no puede repetirse en el cartón"},
  R04:{lvl:"error",t:"Cada fila tiene exactamente 5 números (y 4 casillas negras)"},
  R05:{lvl:"error",t:"El cartón tiene exactamente 15 números"},
  R06:{lvl:"error",t:"En cada columna los números van de menor a mayor hacia abajo"},
  R07:{lvl:"aviso",t:"Cada columna suele tener al menos un número"},
  R08:{lvl:"error",t:"El nº de cartón es obligatorio (solo dígitos, máx. 4, distinto de 0000)"},
  R09:{lvl:"error",t:"La serie es obligatoria (4 dígitos)"},
  R10:{lvl:"error",t:"No puede haber dos cartones con el mismo nº y la misma serie en la partida"},
  R11:{lvl:"error",t:"Dos cartones distintos de la misma serie no pueden tener los mismos 15 números"},
  R12:{lvl:"error",t:"Casilla que el lector no pudo leer: hay que escribirla"},
  R13:{lvl:"error",t:"Los números no pueden empezar con 0 (escribe 5, no 05)"},
  B01:{lvl:"error",t:"Bola fuera del universo 1–90"},
  B02:{lvl:"error",t:"Una bola no se puede cantar dos veces"},
  B03:{lvl:"error",t:"No hay más de 90 bolas"},
  G01:{lvl:"error",t:"La partida necesita la serie de 4 dígitos"},
};
const pad4=s=>{s=String(s??"").replace(/\D/g,"");return s?s.padStart(4,"0").slice(-4):""};
/* número escrito por el usuario → {v, err}. Rechaza 0/00/05/91… sin "arreglarlos" en silencio */
function parseCell(raw){
  const s=String(raw??"").trim();if(s==="")return{v:null};
  if(!/^\d+$/.test(s))return{v:NaN,err:{code:"R01",msg:`"${s}" no es un número`}};
  if(s.length>2)return{v:NaN,err:{code:"R01",msg:`${s} no existe: solo 1 a 90`}};
  if(s[0]==="0")return{v:NaN,err:{code:s==="0"||s==="00"?"R01":"R13",msg:s==="0"||s==="00"?`${s} no existe: los números van del 1 al 90`:`escribe ${+s}, sin el 0 delante`}};
  const v=+s;if(!isNum(v))return{v:NaN,err:{code:"R01",msg:`${v} no existe: los números van del 1 al 90`}};
  return{v};
}
/* grid: 3×9 con número | null (casilla negra) | -1 (sin leer) | NaN (inválido) | string crudo
   devuelve {errors:[{code,msg,cells:[idx]}], warnings:[…], cellErr: Map(idx→msg), rows:[[5]×3] válidas} */
function checkGrid(grid){
  const errors=[],warnings=[],cellErr=new Map(),add=(code,msg,cells)=>{(CATALOG[code].lvl==="aviso"?warnings:errors).push({code,msg,cells:cells||[]});(cells||[]).forEach(i=>{if(!cellErr.has(i))cellErr.set(i,msg)})};
  const val=[],nums=[];// val: número válido en su columna · nums: todo número 1–90 escrito (para detectar repetidos)
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){const i=r*COLS+c;let x=grid[r][c];
    if(typeof x==="string"){const p=parseCell(x);if(p.err){add(p.err.code,`fila ${r+1}: ${p.err.msg}`,[i]);continue}x=p.v}
    if(x==null)continue;
    if(x===-1){add("R12",`fila ${r+1}, columna ${rangeTxt(c)}: casilla sin leer`,[i]);continue}
    if(!isNum(x)){add("R01",`fila ${r+1}: ${Number.isNaN(x)?"valor inválido":x+" no existe (1 a 90)"}`,[i]);continue}
    nums[i]=x;
    if(colOf(x)!==c){add("R02",`${x} va en la columna ${rangeTxt(colOf(x))}, no en ${rangeTxt(c)}`,[i]);continue}
    val[i]=x}
  // R03 repetidos
  const seen=new Map();nums.forEach((v,i)=>{if(v==null)return;if(!seen.has(v))seen.set(v,[]);seen.get(v).push(i)});
  for(const [v,ix] of seen)if(ix.length>1)add("R03",`el ${v} está repetido`,ix);
  // R04 cinco por fila (cuenta todo lo escrito, válido o no, para que el usuario vea la fila real)
  let total=0;
  for(let r=0;r<ROWS;r++){let n=0;const ix=[];for(let c=0;c<COLS;c++){const x=grid[r][c];if(x!=null&&x!==""){n++;ix.push(r*COLS+c)}}total+=n;
    if(n!==PER_ROW)add("R04",`la fila ${r+1} tiene ${n} número${n===1?"":"s"}; deben ser ${PER_ROW}`,n>PER_ROW?ix:[])}
  if(total!==TOTAL)add("R05",`el cartón tiene ${total} números; deben ser ${TOTAL}`);
  // R06 orden en columna
  for(let c=0;c<COLS;c++){let prev=null,pi=-1;for(let r=0;r<ROWS;r++){const i=r*COLS+c,v=val[i];if(v==null)continue;if(prev!=null&&v<=prev)add("R06",`columna ${rangeTxt(c)}: ${v} debe ser mayor que ${prev} (va debajo)`,[pi,i]);prev=v;pi=i}}
  // R07 columna vacía (aviso)
  for(let c=0;c<COLS;c++){let any=false;for(let r=0;r<ROWS;r++){const x=grid[r][c];if(x!=null&&x!=="")any=true}if(!any)add("R07",`la columna ${rangeTxt(c)} no tiene números`)}
  const rows=[0,1,2].map(r=>{const o=[];for(let c=0;c<COLS;c++){const v=val[r*COLS+c];if(v!=null)o.push(v)}return o});
  return{errors,warnings,cellErr,rows};
}
/* cartón completo (cuadrícula + nº + serie + unicidad en la partida) */
function checkCard(card,others){
  const g=checkGrid(card.grid||gridFromRows(card.rows));
  const carton=String(card.carton??""),serie=String(card.serie??"");
  if(!/^\d{1,4}$/.test(carton)||/^0+$/.test(carton))g.errors.push({code:"R08",msg:carton?`nº de cartón "${carton}" inválido`:"falta el nº de cartón",cells:[]});
  if(!/^\d{4}$/.test(serie))g.errors.push({code:"R09",msg:serie?`serie "${serie}" inválida (4 dígitos)`:"falta la serie",cells:[]});
  for(const o of (others||[])){if(o.id===card.id)continue;
    if(carton&&o.carton===pad4(carton)&&o.serie===serie)g.errors.push({code:"R10",msg:`ya existe el cartón ${o.carton} serie ${serie}`,cells:[]});
    else if(o.serie===serie&&g.rows.flat().length===TOTAL&&sameNumbers(o,g.rows))g.errors.push({code:"R11",msg:`tiene los mismos 15 números que el cartón ${o.carton} (serie ${serie}); revisa el nº de cartón`,cells:[]})}
  return g;
}
function sameNumbers(card,rows){const a=(card.rows||[]).flat().filter(isNum).sort((x,y)=>x-y).join(","),b=rows.flat().slice().sort((x,y)=>x-y).join(",");return a===b}
function gridFromRows(rows){const g=[...Array(ROWS)].map(()=>Array(COLS).fill(null));(rows||[]).forEach((row,r)=>(row||[]).forEach(v=>{if(isNum(v)){const c=colOf(v);if(g[r][c]==null)g[r][c]=v;else g[r][c]=NaN}}));return g}
/* bolas: texto libre → {ok:[n], bad:[{tok,code,msg}]} sin repetir ni salir de 1–90 */
function parseBalls(text,already){
  const ok=[],bad=[],have=new Set(already||[]);
  for(const tok of String(text||"").split(/[^0-9]+/).filter(Boolean)){
    const p=parseCell(tok);if(p.err){bad.push({tok,code:"B01",msg:p.err.msg});continue}
    if(have.has(p.v)){bad.push({tok,code:"B02",msg:`${p.v} ya fue cantada`});continue}
    have.add(p.v);ok.push(p.v)}
  if(have.size>90)bad.push({tok:"",code:"B03",msg:"más de 90 bolas"});
  return{ok,bad};
}
function checkBall(v,draws){if(!isNum(v))return{code:"B01",msg:`${v} no existe (1 a 90)`};if((draws||[]).includes(v))return{code:"B02",msg:`${v} ya fue cantada`};if((draws||[]).length>=90)return{code:"B03",msg:"ya salieron las 90 bolas"};return null}
return{CATALOG,MIN,MAX,colOf,colRange,rangeTxt,isNum,pad4,parseCell,checkGrid,checkCard,gridFromRows,parseBalls,checkBall};
})();
