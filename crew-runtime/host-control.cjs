'use strict';
const {readFileSync}=require('node:fs');
const path=require('node:path');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function createHostControl(config,auth,deps={}){
  const workers=Number(config.workers||process.env.NUM_WORKERS||1);
  const request=deps.hostWorkerRequest||(async(index,route,token,body)=>{
    const r=await fetch('http://127.0.0.1:'+(3001+index)+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
    const data=await r.json();if(!r.ok)fail(data.error||'Crew control failed.',r.status);return data;
  });
  const recent=new Map();let serial=Promise.resolve();
  async function status(sid){
    const token=auth.issue(sid);
    // Fail closed if any worker is unavailable; never mistake an outage for no room.
    const rooms=await Promise.all(Array.from({length:workers},(_,i)=>request(i,'/api/crew-host/status',token).then(r=>({index:i,room:r.room}))));
    const existing=rooms.filter(r=>r.room);
    if(existing.length>1)fail('Multiple rooms exist. Open Crew to resolve them.',409);
    const selected=existing[0];
    if(selected){
      const room=selected.room;
      if(!/^[A-Za-z0-9]{8,10}$/.test(room.id)||room.lobbyPath!==`/w${selected.index}/game/${room.id}?lobby`)fail('Invalid room response.',502);
      return {signedIn:true,canHost:true,room:{id:room.id,phase:room.phase,players:room.players,ready:room.ready,canStart:room.canStart,lobbyUrl:config.origin+room.lobbyPath}};
    }
    return {signedIn:true,canHost:true,room:null};
  }
  async function command(sid,input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','roomId','mode','requestId'].includes(k))||!uuid.test(input.requestId||'')||!['open','start','end'].includes(input.action)||!(input.roomId===null||/^[A-Za-z0-9]{8,10}$/.test(input.roomId))||!['active','viewer-bots'].includes(input.mode))fail('Invalid Crew command.');
    const key=sid+':'+input.requestId,fingerprint=JSON.stringify([input.action,input.roomId,input.mode]);
    const previous=recent.get(key);
    if(previous){if(previous.fingerprint!==fingerprint)fail('Request ID was reused with a different command.',409);return previous.result;}
    const result=serial.then(async()=>{
      const current=await status(sid);
      if(input.action!=='open'&&(!input.roomId||current.room?.id!==input.roomId))fail('Room changed or closed. Refresh its status.',409);
      if(input.action==='open'&&input.roomId!==null&&current.room?.id!==input.roomId)fail('Room changed. Refresh its status.',409);
      const index=current.room?Number(new URL(current.room.lobbyUrl).pathname.match(/^\/w(\d+)\//)[1]):0;
      await request(index,'/api/crew-host/control',auth.issue(sid),{action:input.action,roomId:input.roomId,mode:input.mode});
      return status(sid);
    });
    serial=result.catch(()=>{});recent.set(key,{fingerprint,result});
    if(recent.size>128)recent.delete(recent.keys().next().value);
    return result;
  }
  async function handle(req,res,url,json){
    if(!url.pathname.startsWith('/host-control'))return false;
    if(req.method==='GET'&&['/host-control','/host-control.js'].includes(url.pathname)){
      const js=url.pathname.endsWith('.js');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
      res.writeHead(200,{'Content-Type':js?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});
      res.end(readFileSync(path.join(__dirname,js?'host-control-client.js':'host-control.html')));return true;
    }
    const {sid,session}=auth.requireHost(req);await auth.validate(sid);
    if(req.method==='GET'&&url.pathname==='/host-control/status'){json(200,await status(sid));return true;}
    if(req.method==='POST'&&url.pathname==='/host-control/control'){
      auth.mutation(req,session);
      if(!(req.headers['content-type']||'').startsWith('application/json'))fail('JSON required.',415);
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)fail('Command too large.',413);}
      let body;try{body=JSON.parse(raw);}catch{fail('Invalid JSON.');}
      json(200,await command(sid,body));return true;
    }
    json(404,{error:'Unknown Crew control route.'});return true;
  }
  return {handle,status,command};
}
module.exports={createHostControl};
