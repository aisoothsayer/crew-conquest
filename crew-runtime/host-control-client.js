'use strict';
(() => {
  const allowed=new Set(['https://dannyisstuckonline.com','https://ai-soothsayer.aisoothsayer.chatgpt.site']);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const get=id=>document.getElementById(id);
  let state={signedIn:false,canHost:false,room:null},csrf=null,binding=null,busy=false,pendingEnd=null;
  const recent=new Map();let serial=Promise.resolve();
  function show(message){
    get('identity').textContent=state.canHost?'Danny’s host controls':state.signedIn?'This account cannot host Crew.':'Sign in to Crew as Danny.';
    get('signin').hidden=state.canHost;
    get('open').disabled=busy||!!pendingEnd||!state.canHost;get('start').disabled=busy||!!pendingEnd||!state.canHost||!state.room?.canStart;get('end').disabled=busy||!!pendingEnd||!state.canHost||!state.room;
    get('mode').disabled=busy||!!state.room;
    get('room').textContent=state.room?`${state.room.id} · ${state.room.phase} · ${state.room.players} players · ${state.room.ready} points ready`:'No hosted room.';
    const link=get('lobby');link.hidden=!state.room;if(state.room)link.href=state.room.lobbyUrl;
    if(message)get('message').textContent=message;
  }
  async function read(){
    const s=await fetch('/crew-api/session',{cache:'no-store'});
    if(s.status===401){csrf=null;state={signedIn:false,canHost:false,room:null};show('Use Sign in with Twitch, then return to this window.');return state;}
    if(!s.ok)throw Error('Crew sign-in is temporarily unavailable.');
    const session=await s.json();csrf=session.csrf;
    if(!session.user?.canHost){state={signedIn:true,canHost:false,room:null};show('Only Danny can create, start or end a hosted room.');return state;}
    const r=await fetch('/crew-api/host-control/status',{cache:'no-store'});const data=await r.json();
    if(!r.ok)throw Error(data.error||'Room status unavailable.');
    state=data;show(state.room?.canStart?'Starting points are ready.':state.room?.phase==='lobby'?'Open the lobby to configure it and place starting points.':'Room status updated.');return state;
  }
  async function perform(action,roomId,mode,requestId){
    if(action==='status')return read();
    await read();if(!state.canHost||!csrf)throw Error('Sign in to Crew as Danny first.');
    busy=true;show('Working…');
    try{
      const r=await fetch('/crew-api/host-control/control',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf},body:JSON.stringify({action,roomId,mode,requestId})});const data=await r.json();
      if(!r.ok)throw Error(data.error||'Crew command failed.');state=data;show(action==='end'?'Room closed. No winner declared.':'Crew command completed.');return state;
    }finally{busy=false;show();}
  }
  window.addEventListener('message',event=>{
    const m=event.data;
    if(event.source!==window.opener||!window.opener||!allowed.has(event.origin)||!m||m.channel!=='danny-game-control'||m.version!==1||m.game!=='crew'||!uuid.test(m.nonce||'')||!uuid.test(m.id||'')||!['status','open','start','end'].includes(m.action)||!(m.roomId===null||/^[A-Za-z0-9]{8,10}$/.test(m.roomId))||!['active','viewer-bots'].includes(m.mode))return;
    if(!binding){if(m.action!=='status')return;binding={origin:event.origin,nonce:m.nonce};}
    if(binding.origin!==event.origin||binding.nonce!==m.nonce)return;
    const fingerprint=JSON.stringify([m.action,m.roomId,m.mode]);const prior=recent.get(m.id);
    const reply=result=>event.source.postMessage({channel:m.channel,version:1,game:'crew',nonce:m.nonce,id:m.id,...result},event.origin);
    if(prior){if(prior.fingerprint===fingerprint)prior.result.then(reply);else reply({ok:false,error:'Request ID reused with a different command.',status:state});return;}
    const result=serial.then(()=>perform(m.action,m.roomId,m.mode,m.id)).then(status=>({ok:true,status}),e=>{show(e.message);return {ok:false,error:e.message,status:state};});
    serial=result;recent.set(m.id,{fingerprint,result});if(recent.size>64)recent.delete(recent.keys().next().value);result.then(reply);
  });
  for(const action of ['open','start'])get(action).addEventListener('click',()=>{
    if(busy||pendingEnd)return;
    const roomId=state.room?.id??null,mode=get('mode').value,id=crypto.randomUUID();
    serial=serial.then(()=>perform(action,roomId,mode,id)).catch(e=>show(e.message));
  });
  get('end').addEventListener('click',()=>{if(busy||pendingEnd||!state.room)return;pendingEnd={roomId:state.room.id,mode:get('mode').value,id:crypto.randomUUID()};get('end-confirm-room').textContent='Room '+pendingEnd.roomId;get('end-confirm').hidden=false;get('confirm-end').focus?.();show();});
  get('cancel-end').addEventListener('click',()=>{pendingEnd=null;get('end-confirm').hidden=true;show();});
  get('confirm-end').addEventListener('click',()=>{if(busy||!pendingEnd)return;const target=pendingEnd;pendingEnd=null;get('end-confirm').hidden=true;serial=serial.then(()=>perform('end',target.roomId,target.mode,target.id)).catch(e=>show(e.message));});
  get('refresh').addEventListener('click',()=>read().catch(e=>show(e.message)));
  read().catch(e=>show(e.message));
  setInterval(()=>{if(!busy&&!document.hidden)read().catch(e=>show(e.message));},5000);
})();
