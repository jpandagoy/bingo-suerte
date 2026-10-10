/* Bingo de la Suerte · lector de cartones 90 bolas (3 filas × 9 columnas, 5 números por fila).
   Todo corre en el teléfono: umbral adaptativo → rejilla (mayor mancha oscura con forma de cartón) →
   homografía → 27 casillas → 5 casillas blancas por fila → dígitos por plantillas.
   La columna da la decena, así que casi siempre solo hay que reconocer las unidades. */
const BSReader=(function(){
"use strict";
const GW=900,GH=330,CW=GW/9,CH=GH/3,HEAD=82; // rejilla normalizada + franja superior (cartón y serie)
const TW=16,THh=24; // tamaño de plantilla
let TPL=[]; // {d, v:Float32Array, ar}
/* lienzo que funciona en la página y dentro de un Worker (OffscreenCanvas) */
const mkCanvas=(w,h)=>{if(typeof document!=="undefined"){const c=document.createElement("canvas");c.width=w;c.height=h;return c}return new OffscreenCanvas(w,h)};

/* ---------- utilidades de imagen ---------- */
function grayOf(src,maxSide){
  const s=Math.min(1,maxSide/Math.max(src.width,src.height)),w=Math.max(1,Math.round(src.width*s)),h=Math.max(1,Math.round(src.height*s));
  const c=mkCanvas(w,h);const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(src,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data,g=new Uint8ClampedArray(w*h),red=new Uint8Array(w*h);
  for(let i=0,j=0;j<w*h;i+=4,j++){g[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;red[j]=d[i]-Math.max(d[i+1],d[i+2])>50?1:0}
  return{g,w,h,s,red,canvas:c};
}
function integral(g,w,h){const I=new Float64Array((w+1)*(h+1));for(let y=0;y<h;y++){let r=0;for(let x=0;x<w;x++){r+=g[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+r}}return I}
function darkMask(g,w,h,rad,C){
  const I=integral(g,w,h),m=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const y0=Math.max(0,y-rad),y1=Math.min(h,y+rad+1);
    for(let x=0;x<w;x++){const x0=Math.max(0,x-rad),x1=Math.min(w,x+rad+1),a=(x1-x0)*(y1-y0),mean=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/a;
      m[y*w+x]=g[y*w+x]<mean-C?1:0}}
  return m;
}
function dilate(m,w,h,r){const I=new Int32Array((w+1)*(h+1));for(let y=0;y<h;y++){let s=0;for(let x=0;x<w;x++){s+=m[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+s}}
  const o=new Uint8Array(w*h);for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1);o[y*w+x]=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])>0?1:0}}return o}
function components(m,w,h,minA){
  const lab=new Int32Array(w*h),out=[];let n=0;const st=new Int32Array(w*h);
  for(let i=0;i<w*h;i++){if(!m[i]||lab[i])continue;n++;let sp=0;st[sp++]=i;lab[i]=n;
    let a=0,x0=w,x1=0,y0=h,y1=0,tl=1e9,br=-1e9,tr=-1e9,bl=1e9,ptl=0,pbr=0,ptr=0,pbl=0;
    while(sp){const j=st[--sp],y=(j/w)|0,x=j-y*w;a++;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
      const s=x+y,d=x-y;if(s<tl){tl=s;ptl=j}if(s>br){br=s;pbr=j}if(d>tr){tr=d;ptr=j}if(d<bl){bl=d;pbl=j}
      if(x>0&&m[j-1]&&!lab[j-1]){lab[j-1]=n;st[sp++]=j-1}if(x<w-1&&m[j+1]&&!lab[j+1]){lab[j+1]=n;st[sp++]=j+1}
      if(y>0&&m[j-w]&&!lab[j-w]){lab[j-w]=n;st[sp++]=j-w}if(y<h-1&&m[j+w]&&!lab[j+w]){lab[j+w]=n;st[sp++]=j+w}}
    if(a>=minA){const P=k=>[k%w,(k/w)|0];out.push({id:n,a,x0,x1,y0,y1,bw:x1-x0+1,bh:y1-y0+1,corners:[P(ptl),P(ptr),P(pbr),P(pbl)]})}}
  return{comps:out,lab};
}
/* homografía de 4 puntos (dst → src) */
function homog(src,dst){
  const A=[],b=[];for(let i=0;i<4;i++){const [x,y]=dst[i],[u,v]=src[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v)}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[b[c],b[p]]=[b[p],b[c]];
    for(let r=0;r<8;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let k=c;k<8;k++)A[r][k]-=f*A[c][k];b[r]-=f*b[c]}}
  const h=b.map((v,i)=>v/A[i][i]);return[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
}
function warp(G,H,W,Hh,oy){ // muestrea la imagen gris G={g,w,h} en una rejilla W×Hh (desplazada oy en y)
  const out=new Uint8ClampedArray(W*Hh),{g,w,h}=G;
  for(let y=0;y<Hh;y++)for(let x=0;x<W;x++){const X=x+.5,Y=y+.5+oy,z=H[6]*X+H[7]*Y+1,u=(H[0]*X+H[1]*Y+H[2])/z-.5,v=(H[3]*X+H[4]*Y+H[5])/z-.5;
    const x0=Math.floor(u),y0=Math.floor(v);if(x0<0||y0<0||x0>=w-1||y0>=h-1){out[y*W+x]=255;continue}
    const fx=u-x0,fy=v-y0,i=y0*w+x0;out[y*W+x]=g[i]*(1-fx)*(1-fy)+g[i+1]*fx*(1-fy)+g[i+w]*(1-fx)*fy+g[i+w+1]*fx*fy}
  return out;
}
function warpBox(G,H,ox,oy,W,Hh){const out=new Uint8ClampedArray(W*Hh),{g,w,h}=G;
  for(let y=0;y<Hh;y++)for(let x=0;x<W;x++){const X=x+ox+.5,Y=y+oy+.5,z=H[6]*X+H[7]*Y+1,u=(H[0]*X+H[1]*Y+H[2])/z-.5,v=(H[3]*X+H[4]*Y+H[5])/z-.5;
    const x0=Math.floor(u),y0=Math.floor(v);if(x0<0||y0<0||x0>=w-1||y0>=h-1){out[y*W+x]=255;continue}
    const fx=u-x0,fy=v-y0,i=y0*w+x0;out[y*W+x]=g[i]*(1-fx)*(1-fy)+g[i+1]*fx*(1-fy)+g[i+w]*(1-fx)*fy+g[i+w+1]*fx*fy}return out}
function resample(src,SW,sx,sy,sw,sh,W,Hh){const out=new Uint8ClampedArray(W*Hh).fill(255);if(sh<=0)return out;
  for(let y=0;y<Hh;y++){const v=sy+(y+.5)*sh/Hh-.5,y0=Math.max(0,Math.floor(v)),fy=v-y0;for(let x=0;x<W;x++){const u=sx+(x+.5)*sw/W-.5,x0=Math.max(0,Math.floor(u)),fx=u-x0,i=y0*SW+x0;
    out[y*W+x]=src[i]*(1-fx)*(1-fy)+src[i+1]*fx*(1-fy)+src[i+SW]*(1-fx)*fy+src[i+SW+1]*fx*fy}}return out}
function otsu(vals){const hist=new Array(256).fill(0);for(const v of vals)hist[v|0]++;let T=vals.length,sAll=0;for(let i=0;i<256;i++)sAll+=i*hist[i];
  let wB=0,sB=0,mx=0,thr=128;for(let i=0;i<256;i++){wB+=hist[i];if(!wB)continue;const wF=T-wB;if(!wF)break;sB+=i*hist[i];const a=sB/wB,b2=(sAll-sB)/wF,q=wB*wF*(a-b2)**2;if(q>mx){mx=q;thr=i}}return thr}

/* ---------- detección de cartones en una imagen ---------- */
// devuelve lista de rejillas {corners:[tl,tr,br,bl] en px de la imagen original, score}
function detect(src,opts){
  opts=opts||{};const G=grayOf(src,opts.maxSide||900),{g,w,h,s}=G;
  const m=dilate(darkMask(g,w,h,Math.max(8,Math.round(Math.min(w,h)/8)),22),w,h,Math.max(1,Math.round(Math.min(w,h)/300)));
  const {comps}=components(m,w,h,w*h*(opts.multi?0.004:0.02));if(opts.debug){let k=0;for(const v of m)k+=v;opts.debug.push({w,h,dark:k,comps:comps.length})}
  const out=[];if(opts.debug)opts.debug.push(...comps.filter(c=>c.a>w*h*.01).map(c=>({ar:+(c.bw/c.bh).toFixed(2),fill:+(c.a/(c.bw*c.bh)).toFixed(2),bw:c.bw,bh:c.bh,a:c.a,co:c.corners})));
  for(const c of comps){const ar=c.bw/c.bh,fill=c.a/(c.bw*c.bh);
    if(ar<1.35||ar>3.2||fill<.22||fill>.85)continue;
    // los 4 extremos deben formar un cuadrilátero que ocupe casi toda la caja
    const [tl,tr,br,bl]=c.corners,quad=Math.abs((tr[0]-tl[0])*(bl[1]-tl[1])-(bl[0]-tl[0])*(tr[1]-tl[1]))+0;
    if(quad<c.bw*c.bh*.55)continue;
    out.push({corners:c.corners.map(([x,y])=>[x/s,y/s]),area:c.a/s/s,box:{x:c.x0/s,y:c.y0/s,w:c.bw/s,h:c.bh/s},fill});
  }
  out.sort((a,b)=>b.area-a.area);
  if(!opts.multi)return out.slice(0,1);
  const big=out.length?out[0].area:0;return out.filter(o=>o.area>big*.35);
}

/* ---------- dígitos ---------- */
function glyphVec(bin,W,x0,y0,x1,y1){ // caja → vector TW×THh normalizado por alto, centrado
  const bw=x1-x0+1,bh=y1-y0+1,sc=THh/bh,tw=Math.min(TW,Math.max(1,Math.round(bw*sc))),ox=(TW-tw)>>1,v=new Float32Array(TW*THh);
  for(let y=0;y<THh;y++)for(let x=0;x<tw;x++){let s=0,n=0;const sy0=y0+y/sc,sy1=y0+(y+1)/sc,sx0=x0+x*bw/tw,sx1=x0+(x+1)*bw/tw;
    for(let yy=Math.floor(sy0);yy<Math.max(Math.floor(sy0)+1,Math.ceil(sy1));yy++)for(let xx=Math.floor(sx0);xx<Math.max(Math.floor(sx0)+1,Math.ceil(sx1));xx++){n++;s+=bin[yy*W+xx]}
    v[y*TW+x+ox]=n?s/n:0}
  return{v,ar:bw/bh};
}
const glyphVecOf=(...a)=>glyphVec(...a);
function corr(a,b){let ma=0,mb=0;const n=a.length;for(let i=0;i<n;i++){ma+=a[i];mb+=b[i]}ma/=n;mb/=n;let s=0,na=0,nb=0;for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;s+=x*y;na+=x*x;nb+=y*y}return na&&nb?s/Math.sqrt(na*nb):0}
function scores(gl){const sc=new Array(10).fill(-1);for(const t of TPL){const s=corr(gl.v,t.v)-Math.abs(Math.log((gl.ar+.05)/(t.ar+.05)))*.3;if(s>sc[t.d])sc[t.d]=s}return sc}
function best(sc,allowed){let d=-1,b=-9,b2=-9;for(let i=0;i<10;i++){if(allowed&&!allowed.includes(i))continue;if(sc[i]>b){b2=b;b=sc[i];d=i}else if(sc[i]>b2)b2=sc[i]}return{d,s:b,m:b-b2}}
/* plantillas: se dibujan con varias tipografías condensadas (parecidas a la del cartón) + muestras reales */
function buildTemplates(fonts,real){
  TPL=[];const c=mkCanvas(80,90);const x=c.getContext("2d",{willReadFrequently:true});
  for(const f of fonts)for(let d=0;d<10;d++){x.fillStyle="#fff";x.fillRect(0,0,80,90);x.fillStyle="#000";x.font=f;x.textBaseline="middle";x.textAlign="center";x.fillText(String(d),40,46);
    const id=x.getImageData(0,0,80,90).data,bin=new Uint8Array(80*90);let x0=80,x1=-1,y0=90,y1=-1;
    for(let i=0;i<80*90;i++){const on=id[i*4]<128?1:0;bin[i]=on;if(on){const xx=i%80,yy=(i/80)|0;if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(yy<y0)y0=yy;if(yy>y1)y1=yy}}
    if(x1<0)continue;const gv=glyphVec(bin,80,x0,y0,x1,y1);TPL.push({d,v:gv.v,ar:gv.ar,src:f})}
  for(const r of (real||[]))TPL.push({d:r.d,v:Float32Array.from(r.q,ch=>parseInt(ch,16)/15),ar:r.ar,src:"real"});
}
/* glifos (componentes oscuros) dentro de un recorte binario */
function glyphs(bin,W,H,minH){
  const {comps}=components(bin,W,H,8);
  let gl=comps.filter(c=>c.bh>=minH&&c.bh<H*.97&&c.bw<W*.95);
  gl.sort((a,b)=>a.x0-b.x0);
  // unir trozos que se solapan en x (dígito partido)
  const mg=[];for(const q of gl){const l=mg[mg.length-1];if(l&&q.x0<l.x1-Math.min(q.bw,l.bw)*.5){l.x0=Math.min(l.x0,q.x0);l.x1=Math.max(l.x1,q.x1);l.y0=Math.min(l.y0,q.y0);l.y1=Math.max(l.y1,q.y1)}else mg.push({x0:q.x0,x1:q.x1,y0:q.y0,y1:q.y1})}
  return mg.map(q=>({...q,...glyphVec(bin,W,q.x0,q.y0,q.x1,q.y1)}));
}
function binarize(px,thr){const b=new Uint8Array(px.length);for(let i=0;i<px.length;i++)b[i]=px[i]<thr?1:0;return b}

/* ---------- lectura de un cartón ---------- */
function erode(m,w,h,r){const inv=new Uint8Array(w*h);for(let i=0;i<w*h;i++)inv[i]=m[i]?0:1;const d=dilate(inv,w,h,r);for(let i=0;i<w*h;i++)d[i]=d[i]?0:1;return d}
function lsq(rows,ys){ // mínimos cuadrados pequeño (normal equations)
  const n=rows[0].length,A=Array.from({length:n},()=>new Array(n).fill(0)),b=new Array(n).fill(0);
  rows.forEach((r,k)=>{for(let i=0;i<n;i++){b[i]+=r[i]*ys[k];for(let j=0;j<n;j++)A[i][j]+=r[i]*r[j]}});
  for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[b[c],b[p]]=[b[p],b[c]];if(Math.abs(A[c][c])<1e-9)return null;
    for(let r=0;r<n;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let k=c;k<n;k++)A[r][k]-=f*A[c][k];b[r]-=f*b[c]}}
  return b.map((v,i)=>v/A[i][i]);
}
function crop(src,SW,SH,cx,cy,w,h){const W=Math.max(4,Math.round(w)),Hh=Math.max(4,Math.round(h)),out=new Uint8ClampedArray(W*Hh),x0=Math.round(cx-w/2),y0=Math.round(cy-h/2);
  for(let y=0;y<Hh;y++)for(let x=0;x<W;x++){const X=x0+x,Y=y0+y;out[y*W+x]=X<0||Y<0||X>=SW||Y>=SH?255:src[Y*SW+X]}return{px:out,W,H:Hh}}
function readGrid(src,corners,rot){
  const G=grayOf(src,2000),k=G.s;let cs=corners.map(([x,y])=>[x*k,y*k]);
  if(rot)cs=[cs[2],cs[3],cs[0],cs[1]]; // cartón al revés: girar 180°
  const H=homog(cs,[[0,0],[GW,0],[GW,GH],[0,GH]]);
  // 1) enderezado amplio con márgenes
  const MX=70,MY=150,BW=GW+2*MX,BH=GH+MY+70,big=warpBox(G,H,-MX,-MY,BW,BH);
  // 2) casillas negras: umbral + erosión (borra las líneas finas) → rectángulos del tamaño de una casilla
  const thr=otsu(big);
  const findBlk=()=>{const er=erode(binarize(big,thr),BW,BH,3),{comps}=components(er,BW,BH,CW*CH*.25);
    return comps.filter(c=>c.bw>CW*.45&&c.bw<CW*1.35&&c.bh>CH*.45&&c.bh<CH*1.35&&c.a/(c.bw*c.bh)>.4).map(c=>{const cx=(c.x0+c.x1)/2,cy=(c.y0+c.y1)/2;return{cx,cy,c:Math.round((cx-MX)/CW-.5),r:Math.round((cy-MY)/CH-.5),bw:c.bw+6,bh:c.bh+6}}).filter(b=>b.c>=0&&b.c<9&&b.r>=0&&b.r<3)};
  // 2b) perspectiva: homografía rejilla ideal → casillas negras, en 2 pasadas (cada pasada encuentra más casillas negras);
  //     si un punto no encaja (casilla mal asignada) se descarta y se reajusta
  let blk=findBlk();
  for(let pass=0;pass<2&&blk.length>=6;pass++){let pts=blk.slice(),h=null,P=null,ok=false;
    for(let it=0;it<4&&pts.length>=6;it++){const R=[],Y=[];for(const b of pts){const u=MX+(b.c+.5)*CW,v=MY+(b.r+.5)*CH;R.push([u,v,1,0,0,0,-u*b.cx,-v*b.cx]);Y.push(b.cx);R.push([0,0,0,u,v,1,-u*b.cy,-v*b.cy]);Y.push(b.cy)}
      h=lsq(R,Y);if(!h)break;P=(u,v)=>{const z=h[6]*u+h[7]*v+1;return[(h[0]*u+h[1]*v+h[2])/z,(h[3]*u+h[4]*v+h[5])/z]};
      const e=pts.map(b=>{const [x,y]=P(MX+(b.c+.5)*CW,MY+(b.r+.5)*CH);return Math.hypot(x-b.cx,y-b.cy)}),mx=Math.max(...e);
      if(mx<CW*.25){ok=true;break}pts.splice(e.indexOf(mx),1)}
    if(!ok)break;
    let moved=0;for(const b of pts){moved=Math.max(moved,Math.hypot(b.cx-MX-(b.c+.5)*CW,b.cy-MY-(b.r+.5)*CH))}
    if(moved<2)break; // ya está derecho
    const nb=new Uint8ClampedArray(BW*BH);for(let v=0;v<BH;v++)for(let u=0;u<BW;u++){const [x,y]=P(u,v),X=Math.floor(x),Yy=Math.floor(y);
      if(X<0||Yy<0||X>=BW-1||Yy>=BH-1){nb[v*BW+u]=255;continue}const fx_=x-X,fy_=y-Yy,i=Yy*BW+X;nb[v*BW+u]=big[i]*(1-fx_)*(1-fy_)+big[i+1]*fx_*(1-fy_)+big[i+BW]*(1-fx_)*fy_+big[i+BW+1]*fx_*fy_}
    big.set(nb);blk=findBlk()}
  let fx=null,fy=null;
  if(blk.length>=5){fx=lsq(blk.map(b=>[1,b.c,b.r]),blk.map(b=>b.cx));fy=lsq(blk.map(b=>[1,b.r,b.c]),blk.map(b=>b.cy))}
  if(!fx||!fy||fx[1]<CW*.6||fx[1]>CW*1.4||fy[1]<CH*.6||fy[1]>CH*1.4){fx=[MX+CW/2,CW,0];fy=[MY+CH/2,CH,0]}
  const cellX=(r,c)=>fx[0]+fx[1]*c+fx[2]*r,cellY=(r,c)=>fy[0]+fy[1]*r+fy[2]*c,cw=fx[1],ch=fy[1];
  // brillo de cada casilla
  // proporción de tinta en el centro de cada casilla: la negra ronda 0,6; la del número 0,1–0,35
  const cells=[];for(let r=0;r<3;r++)for(let c=0;c<9;c++){const q=crop(big,BW,BH,cellX(r,c),cellY(r,c),cw*.7,ch*.7);let s=0;for(const v of q.px)if(v<thr)s++;cells.push({r,c,ink:s/q.px.length})}
  const doubts=[],rows=[[],[],[]];
  for(let r=0;r<3;r++){const rc=cells.filter(q=>q.r===r).sort((a,b)=>a.ink-b.ink);if(rc[5].ink-rc[4].ink<.1)doubts.push({r,why:"casillas"});rows[r]=rc.slice(0,5).sort((a,b)=>a.c-b.c)}
  const nums=[[],[],[]],dbg=[];
  for(let r=0;r<3;r++)for(const cell of rows[r]){const c=cell.c;
    const q=crop(big,BW,BH,cellX(r,c),cellY(r,c),cw*1.08,ch*.95),{px,W}=q,Hh=q.H;
    const t2=Math.min(otsu(px),200),bin=binarize(px,t2);
    // solo cerca del borde del recorte: líneas de la rejilla (no tocar los trazos de los dígitos)
    for(let x=0;x<W;x++){if(x>W*.1&&x<W*.9)continue;let kk=0;for(let y=0;y<Hh;y++)kk+=bin[y*W+x];if(kk>Hh*.6)for(let y=0;y<Hh;y++)bin[y*W+x]=0}
    for(let y=0;y<Hh;y++){if(y>Hh*.12&&y<Hh*.88)continue;let kk=0;for(let x=0;x<W;x++)kk+=bin[y*W+x];if(kk>W*.5)for(let x=0;x<W;x++)bin[y*W+x]=0}
    let gl=glyphs(bin,W,Hh,Hh*.38).filter(g=>{const cx=(g.x0+g.x1)/2;return cx>W*.12&&cx<W*.88&&g.x1-g.x0<W*.8});const want=c===0?1:2;
    if(gl.length>want)gl=gl.slice().sort((a,b)=>(b.y1-b.y0)*(b.x1-b.x0)-(a.y1-a.y0)*(a.x1-a.x0)).slice(0,want).sort((a,b)=>a.x0-b.x0);
    if(gl.length===1&&want===2&&(gl[0].x1-gl[0].x0+1)>(gl[0].y1-gl[0].y0+1)*.85){
      // dos dígitos pegados: probar cortes entre 30% y 70% y quedarse con el que mejor lee la decena conocida + la unidad
      const g0=gl[0],tens=c===8?[8,9]:[c];let bestSp=null;
      const piece=(a,b)=>{let y0=1e9,y1=-1,xa=1e9,xb=-1;for(let y=g0.y0;y<=g0.y1;y++)for(let x=a;x<=b;x++)if(bin[y*W+x]){if(y<y0)y0=y;if(y>y1)y1=y;if(x<xa)xa=x;if(x>xb)xb=x}
        return y1<0||y1-y0<(g0.y1-g0.y0)*.6?null:{x0:xa,x1:xb,y0,y1,...glyphVec(bin,W,xa,y0,xb,y1)}};
      for(let x=g0.x0+Math.round((g0.x1-g0.x0)*.3);x<=g0.x0+Math.round((g0.x1-g0.x0)*.7);x++){const A=piece(g0.x0,x),B=piece(x+1,g0.x1);if(!A||!B)continue;
        const sa=scores(A),sb=best(scores(B)),tot=Math.max(...tens.map(t=>sa[t]))+sb.s;if(!bestSp||tot>bestSp.tot)bestSp={tot,gl:[A,B]}}
      if(bestSp)gl=bestSp.gl}
    let v=null,conf=0,why="";
    if(!gl.length)why="sin dígito";
    else if(c===0){const b=best(scores(gl[gl.length-1]),[1,2,3,4,5,6,7,8,9]);v=b.d;conf=b.m}
    else{const u=gl[gl.length-1],bu=best(scores(u));v=c*10+bu.d;conf=bu.m;
      if(c===8&&gl.length>=2){const bt=best(scores(gl[0]),[8,9]);if(bt.d===9&&bu.d===0)v=90}
      if(gl.length<2)why="un solo dígito";else{const bt=best(scores(gl[0]));if(bt.d!==c&&!(c===8&&bt.d===9)&&bt.m>.08)conf=Math.min(conf,.02)}}
    nums[r].push({c,v,conf,why,glyphs:gl.length});dbg.push({W,H:Hh,t2,bin:Array.from(bin).join(''),r,c,gl:gl.map(g=>({ar:g.ar,v:Array.from(g.v,x=>Math.round(x*15).toString(16)).join("")}))});
  }
  const flat=nums.flat(),vals=flat.map(n=>n.v);
  flat.forEach((n,i)=>{if(n.v==null||n.conf<.08||n.why)doubts.push({r:Math.floor(i/5),i,why:n.why||"poco seguro"})});
  for(let c=0;c<9;c++){const col=[0,1,2].map(r=>nums[r].find(n=>n.c===c)).filter(Boolean);for(let i=1;i<col.length;i++)if(col[i].v!=null&&col[i-1].v!=null&&col[i].v<=col[i-1].v)doubts.push({c,why:"orden en columna"})}
  if(new Set(vals).size!==vals.length)doubts.push({why:"números repetidos"});
  for(let c=0;c<9;c++)if(!flat.some(n=>n.c===c))doubts.push({c,why:"columna vacía"});
  // franja de cartón y serie: encima de la fila 0
  const topY=fy[0]-fy[1]/2,hh=ch*.75,head=new Uint8ClampedArray(GW*HEAD);
  for(let y=0;y<HEAD;y++){const Y=Math.round(topY-hh+(y+.5)*hh/HEAD);for(let x=0;x<GW;x++){const X=Math.round(fx[0]-fx[1]/2+(x+.5)*(fx[1]*9)/GW);head[y*GW+x]=X<0||Y<0||X>=BW||Y>=BH?255:big[Y*BW+X]}}
  const hd=readHeader(head);
  // miniatura (rejilla ajustada)
  const gx0=fx[0]-fx[1]/2,gy0=topY-hh,gw=fx[1]*9,gh=fy[1]*3+hh,th=mkCanvas(480,Math.max(1,Math.round(480*gh/gw)));
  const id=th.getContext("2d").createImageData(th.width,th.height);for(let y=0;y<th.height;y++)for(let x=0;x<th.width;x++){const X=Math.round(gx0+x*gw/th.width),Y=Math.round(gy0+y*gh/th.height),v=X<0||Y<0||X>=BW||Y>=BH?255:big[Y*BW+X],i=(y*th.width+x)*4;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=255}
  th.getContext("2d").putImageData(id,0,0);
  return{rows:nums.map(r=>r.map(n=>n.v)),cells:nums,doubts,carton:hd.carton,serie:hd.serie,headConf:hd.conf,cartonConf:hd.cconf,thumb:th,blacks:blk.length,_dbg:dbg,_blk:blk.map(b=>[b.r,b.c,Math.round(b.cx),Math.round(b.cy),b.bw,b.bh]),_fit:[fx,fy]};
}
function readHeader(head){
  const W=GW,H=HEAD,bin=darkMask(head,W,H,18,18);
  // quitar la línea del borde superior de la rejilla (filas casi completas) para que no se pegue a los dígitos
  for(let y=0;y<H;y++){let k=0;for(let x=0;x<W;x++)k+=bin[y*W+x];if(k>W*.25)for(let x=0;x<W;x++)bin[y*W+x]=0}
  const {comps}=components(bin,W,H,6);
  const tall=comps.filter(c=>c.bh>H*.22&&c.bh<H*.95&&c.bw<c.bh*1.3);
  const read=(list)=>{if(!list.length)return{s:"",conf:0};const hMax=Math.max(...list.map(c=>c.bh));const dg=list.filter(c=>c.bh>hMax*.78).sort((a,b)=>a.x0-b.x0);
    let s="",conf=1;for(const c of dg.slice(-4)){const gv=glyphVec(bin,W,c.x0,c.y0,c.x1,c.y1),b=best(scores(gv));s+=b.d;conf=Math.min(conf,b.m)}return{s,conf}};
  const left=read(tall.filter(c=>c.x1<W*.5)),right=read(tall.filter(c=>c.x0>W*.62));
  return{carton:left.s,serie:right.s,conf:Math.min(left.conf,right.conf),cconf:left.conf};
}
/* nitidez (varianza del laplaciano) para disparar la captura automática */
function sharpness(src){const G=grayOf(src,480),{g,w,h}=G;let s=0,s2=0,n=0;for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2){const i=y*w+x,l=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];s+=l;s2+=l*l;n++}const m=s/n;return s2/n-m*m}
/* plantillas precalculadas (tpl.json): no depende de tipografías → funciona sin internet */
function setTemplates(list){TPL=list.map(t=>({d:t.d,v:Float32Array.from(t.q,ch=>parseInt(ch,16)/15),ar:t.ar,src:t.s||"pre"}))}
function addTemplates(list){for(const t of list)TPL.push({d:t.d,v:Float32Array.from(t.q,ch=>parseInt(ch,16)/15),ar:t.ar,src:"user"})}
function exportTemplates(){return TPL.map(t=>({d:t.d,q:Array.from(t.v,x=>Math.round(x*15).toString(16)).join(""),ar:+t.ar.toFixed(4),s:t.src==="real"?"r":"f"}))}
/* lectura completa de un cartón ya localizado → cuadrícula 3×9 (número | -1 sin leer | null negra) + dudas */
function readCard(img,corners){
  let r=readGrid(img,corners,0),rot=0;
  if(r.doubts.length>2){const r2=readGrid(img,corners,1);if(r2.doubts.length<r.doubts.length){r=r2;rot=180}}
  const grid=[...Array(3)].map(()=>Array(9).fill(null)),dub=[];
  r.cells.forEach((row,ri)=>row.forEach(n=>{const i=ri*9+n.c;grid[ri][n.c]=n.v==null?-1:n.v;if(n.v==null||n.conf<.08||n.why)dub.push(i)}));
  const p4=s=>{s=String(s||"").replace(/\D/g,"");return s?s.padStart(4,"0").slice(-4):""};
  const carton=/^\d{1,4}$/.test(r.carton)?p4(r.carton):"";if(carton&&r.cartonConf<.05)dub.push(-1);
  return{carton,serieRead:p4(r.serie),grid,dub,rot,blacks:r.blacks,cartonConf:+(r.cartonConf||0).toFixed(3),doubts:r.doubts.map(d=>d.why),thumbCanvas:r.thumb};
}
return{detect,readGrid,readCard,buildTemplates,setTemplates,addTemplates,exportTemplates,sharpness,get templates(){return TPL.length},_glyphVec:glyphVec};
})();
