'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createServer}=require('./server.cjs');const {route}=require('./gateway.cjs');
async function fixture(userId='123'){
  let room=null,writes=0,down=false;
  const app=createServer({origin:'http://localhost:9000',workers:1,clientId:'fixture-client',clientSecret:'fixture-only',ownerId:'123'},{
    fetcher:async(url)=>({ok:true,json:async()=>url.endsWith('/token')?{access_token:'fixture-token'}:url.endsWith('/validate')?{client_id:'fixture-client',user_id:userId,expires_in:14400}:{data:[{id:userId,login:'fixture',display_name:'Fixture',profile_image_url:''}]}}),
    hostWorkerRequest:async(index,path,token,body)=>{if(down)throw Error('worker unavailable');app.auth.verifyTicket(token);if(body){writes++;if(body.action==='open'&&!room)room={id:'Abcd1234',phase:'lobby',players:1,ready:1,canStart:true,lobbyPath:'/w0/game/Abcd1234?lobby'};if(body.action==='start'){room.phase='countdown';room.canStart=false;}if(body.action==='end')room=null;}return {room};},
  });
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const begin=app.auth.begin('/host-control'),params=new URL(begin.url).searchParams;params.set('code','fixture');
  const login=await app.auth.callback({headers:{cookie:begin.cookie.split(';')[0]}},params);
  const base='http://127.0.0.1:'+app.server.address().port,cookie='crew_session='+login.sid;
  return {...app,base,login,cookie,get writes(){return writes;},set down(v){down=v;},set room(v){room=v;},
    async post(action,roomId=null,extra={},headers={}){return fetch(base+'/host-control/control',{method:'POST',headers:{cookie,origin:'http://localhost:9000','x-csrf-token':login.session.csrf,'Content-Type':'application/json',...headers},body:JSON.stringify({action,roomId,mode:'active',requestId:randomUUID(),...extra})});},
    async stop(){app.server.closeAllConnections();await new Promise(r=>app.server.close(r));},
  };
}
test('control page routes and OAuth preserve the control destination',async()=>{const f=await fixture();try{assert.equal(f.login.returnTo,'/host-control');assert.deepEqual(route('/host-control'),{port:9120,path:'/host-control'});const r=await fetch(f.base+'/host-control');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await r.text(),/Start round/);}finally{await f.stop();}});
test('guests, viewers, foreign origin and wrong CSRF cannot write',async()=>{const f=await fixture(),v=await fixture('456');try{assert.equal((await fetch(f.base+'/host-control/status')).status,401);assert.equal((await v.post('open')).status,403);assert.equal((await f.post('open',null,{}, {origin:'https://other.example'})).status,403);assert.equal((await f.post('open',null,{}, {'x-csrf-token':'wrong'})).status,403);assert.equal(f.writes,0);assert.equal(v.writes,0);}finally{await f.stop();await v.stop();}});
test('open reuses room, retries do not write twice and request ID collisions reject',async()=>{const f=await fixture();try{const id=randomUUID();const responses=await Promise.all([f.post('open',null,{requestId:id}),f.post('open',null,{requestId:id})]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(f.writes,1);const data=await responses[0].json();assert.equal(data.room.lobbyUrl,'http://localhost:9000/w0/game/Abcd1234?lobby');assert.equal('token' in data,false);assert.equal((await f.post('end','Abcd1234',{requestId:id})).status,409);assert.equal(f.writes,1);}finally{await f.stop();}});
test('stale targets reject, correct end preserves host session',async()=>{const f=await fixture();try{await f.post('open');assert.equal((await f.post('start','Oldroom1')).status,409);assert.equal((await f.post('end','Oldroom1')).status,409);assert.equal(f.writes,1);assert.equal((await f.post('start','Abcd1234')).status,200);assert.equal((await f.post('end','Abcd1234')).status,200);const s=await fetch(f.base+'/session',{headers:{cookie:f.cookie}});assert.equal(s.status,200);assert.equal((await f.post('open')).status,200);}finally{await f.stop();}});
test('unavailable worker and injected authority fields fail closed',async()=>{const f=await fixture();try{f.down=true;assert.equal((await f.post('open')).status,500);assert.equal(f.writes,0);f.down=false;assert.equal((await f.post('open',null,{hostId:'123'})).status,400);assert.equal((await f.post('open',null,{mode:'bogus'})).status,400);assert.equal(f.writes,0);}finally{await f.stop();}});
