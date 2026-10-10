/* Bingo de la Suerte · motor del escáner en segundo plano.
   La detección (cada cuadro) y la lectura (al capturar) corren aquí, fuera de la pantalla:
   la interfaz y el video nunca se congelan mientras se procesa. */
importScripts("reader.js");
let ready=false;
self.onmessage=async e=>{const m=e.data;
  try{
    if(m.type==="tpl"){BSReader.setTemplates(m.tpl);if(m.extra)BSReader.addTemplates(m.extra);ready=true;self.postMessage({type:"ready",n:BSReader.templates});return}
    if(m.type==="detect"){const t0=performance.now(),d=BSReader.detect(m.bmp,{maxSide:640})[0]||null;const w=m.bmp.width,h=m.bmp.height;m.bmp.close();
      self.postMessage({type:"det",id:m.id,q:d?d.corners:null,w,h,ms:performance.now()-t0});return}
    if(m.type==="read"){const t0=performance.now();if(!ready)throw new Error("plantillas no cargadas");
      const d=BSReader.detect(m.bmp)[0];if(!d){m.bmp.close();self.postMessage({type:"read",id:m.id,none:true,ms:performance.now()-t0});return}
      const rd=BSReader.readCard(m.bmp,d.corners),res=[m.bmp.width,m.bmp.height];m.bmp.close();
      const blob=await rd.thumbCanvas.convertToBlob({type:"image/jpeg",quality:.72});delete rd.thumbCanvas;
      self.postMessage({type:"read",id:m.id,rd,blob,res,ms:performance.now()-t0});return}
  }catch(err){self.postMessage({type:"error",id:m.id,op:m.type,msg:err.message,stack:String(err.stack||"").split("\n").slice(0,6).join("\n")});try{m.bmp&&m.bmp.close()}catch(_){}}
};
