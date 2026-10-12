'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TwitchAuth,safeReturnTo}=require('./twitch-auth.cjs');
const {inviteGate}=require('./invite-gate.cjs');
test('return destinations only admit local game invitations',()=>{
 assert.equal(safeReturnTo('/w0/game/Abcd1234?lobby&s=hello'),'/w0/game/Abcd1234?lobby');
 for(const value of ['https://evil.example/game/Abcd1234','//evil.example/game/Abcd1234','/\\evil.example','/admin','/w0/game/Abcd1234?returnTo=https://evil.example','/w0/game/Abcd1234#secret','/w2/game/Abcd1234','/w0/game/too-short'])assert.equal(safeReturnTo(value),'/crew.html');
});
test('OAuth stores the destination in browser-bound state and ignores callback return tampering',async()=>{
 const auth=new TwitchAuth({origin:'https://crew.example',clientId:'fixture',clientSecret:'fixture',ownerId:'123'},{fetcher:async u=>({ok:true,json:async()=>u.endsWith('/token')?{access_token:'fixture'}:u.endsWith('/validate')?{client_id:'fixture',user_id:'123',expires_in:1000}:{data:[{id:'123',login:'danny'}]}})});
 const begin=auth.begin('/w1/game/Abcd1234?lobby');const p=new URL(begin.url).searchParams;p.set('code','fixture');p.set('returnTo','https://evil.example');
 const result=await auth.callback({headers:{cookie:begin.cookie.split(';')[0]}},p);
 assert.equal(result.returnTo,'/w1/game/Abcd1234?lobby');assert.ok(result.cookies.every(c=>c.includes('Secure')));
 await assert.rejects(auth.callback({headers:{cookie:begin.cookie.split(';')[0]}},p));
});
test('unsigned invitation redirects before starting a lobby socket; signed-in requests continue',async()=>{
 const original=global.fetch;
 try{for(const ok of [false,true]){
  global.fetch=async()=>({ok,status:ok?200:401,body:{cancel:async()=>{}}});
  let continued=false,redirect;const res={writeHead:(status,headers)=>redirect={status,headers},end:()=>{}};
  await inviteGate()({method:'GET',url:'/w0/game/Abcd1234?lobby',headers:{}},res,()=>continued=true);
  assert.equal(continued,ok);if(!ok){assert.equal(redirect.status,302);assert.equal(redirect.headers.Location,'/auth/login?returnTo=%2Fw0%2Fgame%2FAbcd1234%3Flobby');}
 }}finally{global.fetch=original;}
});
