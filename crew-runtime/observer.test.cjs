'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('./server.cjs');
const {TwitchAuth}=require('./twitch-auth.cjs');

test('observer tickets are signed, game-bound, stable for one browser, expiring and never host credentials',()=>{
  let now=1000000;
  const auth=new TwitchAuth({origin:'http://localhost:9000'}, {now:()=>now});
  const token=auth.issueObserver('AbCd1234','browser-one'),verified=auth.verifyTicket(token);
  assert.equal(verified.claims.role,'crew-observer');assert.equal(verified.claims.observerGameID,'AbCd1234');assert.equal(verified.sid,null);assert.equal(verified.user.canHost,false);
  assert.equal(auth.verifyTicket(auth.issueObserver('AbCd1234','browser-one')).subject,verified.subject);
  assert.notEqual(auth.verifyTicket(auth.issueObserver('AbCd1234','browser-two')).subject,verified.subject);
  assert.throws(()=>auth.requireHost({headers:{cookie:'crew_session='+token}}),e=>e.status===401);
  assert.throws(()=>auth.issue(verified.sid),e=>e.status===401);
  const parts=token.split('.'),payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.role='crew-host';parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.throws(()=>auth.verifyTicket(parts.join('.')),e=>e.status===401);
  now+=14400001;assert.throws(()=>auth.verifyTicket(token),e=>e.status===401);
});

test('public observer HTTP only issues a read-only ticket for the current live match, without Twitch login',async()=>{
  let match=null;
  const app=createServer({origin:'http://localhost:9000'},{currentMatch:async()=>match});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    assert.equal((await fetch(base+'/observer-session?gameID=AbCd1234')).status,404);
    match={gameID:'AbCd1234',live:true,createdAt:1,path:'/w0/game/AbCd1234',map:'United States'};
    assert.equal((await fetch(base+'/observer-session?gameID=Other123')).status,404);
    const r=await fetch(base+'/observer-session?gameID=AbCd1234');assert.equal(r.status,200);
    const {token}=await r.json();const entry=app.auth.verifyTicket(token);assert.equal(entry.claims.observerGameID,match.gameID);
    const profile=await fetch(base+'/users/@me',{headers:{authorization:'Bearer '+token}}).then(r=>r.json());assert.equal(profile.user,null);assert.equal(profile.player.canCreatePublicLobbies,false);
    assert.equal((await fetch(base+'/host-access',{headers:{authorization:'Bearer '+token}})).status,401);
    assert.equal((await fetch(base+'/game-ticket',{method:'POST',headers:{authorization:'Bearer '+token}})).status,401);
    match.live=false;assert.equal((await fetch(base+'/observer-session?gameID=AbCd1234')).status,404);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
});
