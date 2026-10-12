'use strict';
const {safeReturnTo}=require('./twitch-auth.cjs');
function inviteGate(identityOrigin='http://127.0.0.1:9120') {
 return async (req,res,next)=>{
  if(req.method!=='GET')return next();
  const target=safeReturnTo(req.originalUrl||req.url);
  if(target==='/crew.html')return next();
  try {
   const r=await fetch(identityOrigin+'/session',{headers:{cookie:req.headers.cookie||''},redirect:'error',signal:AbortSignal.timeout(5000)});
   await r.body?.cancel();
   if(r.ok)return next();
   if(r.status===401||r.status===403){res.writeHead(302,{Location:'/auth/login?returnTo='+encodeURIComponent(target),'Cache-Control':'no-store'});return res.end();}
  }catch{}
  res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
  res.end('Crew sign-in is temporarily unavailable. Please try your invitation again shortly.');
 };
}
module.exports={inviteGate};
