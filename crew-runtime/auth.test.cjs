'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {TwitchAuth,identity}=require('./twitch-auth.cjs');
function fixture(userId='123',overrides={}){
  let time=1000000;const calls=[];
  const auth=new TwitchAuth({origin:'http://localhost:9120',clientId:'fixture-client',clientSecret:'fixture-only',ownerId:'123'}, {now:()=>time,fetcher:async(url,options)=>{
    calls.push(url);const value=url.endsWith('/token')?{access_token:'fixture-access'}:url.endsWith('/validate')?{client_id:'fixture-client',user_id:userId,expires_in:14400,...overrides.validation}:{data:[{id:userId,login:userId==='123'?'aisoothsayer':'viewer',display_name:userId==='123'?'Danny':'Viewer',profile_image_url:'',...overrides.profile}]};
    return {ok:true,json:async()=>value};
  }});
  function begin(){const result=auth.begin();const params=new URL(result.url).searchParams;params.set('code','fixture-code');return {params,req:{headers:{cookie:result.cookie.split(';')[0]}}};}
  async function login(){const r=begin();return auth.callback(r.req,r.params);}
  return {auth,begin,login,calls,advance(ms){time+=ms;}};
}
test('unconfigured sign-in refuses rather than inventing users',()=>{
 const a=new TwitchAuth({origin:'http://localhost:9120'});assert.throws(()=>a.begin(),e=>e.status===503);
});
test('numeric Twitch ID is the stable game identity, distinct across viewers',()=>{
 assert.equal(identity('123'),identity('123'));assert.notEqual(identity('123'),identity('124'));assert.equal(Buffer.from(identity('123'),'base64url').length,16);
});
test('OAuth uses fixed callback, empty scope and browser-bound one-use state',async()=>{
 const f=fixture();const r=f.begin();assert.equal(r.params.get('scope'),'');assert.equal(r.params.get('redirect_uri'),'http://localhost:9120/auth/callback');
 await assert.rejects(f.auth.callback({headers:{cookie:'crew_oauth=wrong'}},r.params),e=>e.status===403);
 await assert.rejects(f.auth.callback(r.req,r.params),e=>e.status===403);assert.equal(f.calls.length,0);
});
test('expired OAuth state is rejected without contacting Twitch',async()=>{
 const f=fixture();const r=f.begin();f.advance(600001);await assert.rejects(f.auth.callback(r.req,r.params),e=>e.status===403);assert.equal(f.calls.length,0);
});
test('successful callback validates token audience and profile; cannot replay',async()=>{
 const f=fixture();const r=f.begin();const signed=await f.auth.callback(r.req,r.params);assert.equal(signed.session.user.login,'aisoothsayer');assert.equal(signed.session.user.canHost,true);assert.equal(f.calls.length,3);
 await assert.rejects(f.auth.callback(r.req,r.params),e=>e.status===403);
});
test('another app token cannot authenticate',async()=>{
 const f=fixture('123',{validation:{client_id:'different-client'}});await assert.rejects(f.login(),e=>e.status===403);assert.equal(f.auth.sessions.size,0);
});
test('profile mismatch cannot authenticate',async()=>{
 const f=fixture('123',{profile:{id:'456'}});await assert.rejects(f.login(),e=>e.status===403);assert.equal(f.auth.sessions.size,0);
});
test('viewers can hold tickets but cannot host or spoof host using login',async()=>{
 const f=fixture('456',{profile:{login:'aisoothsayer',display_name:'Danny'}});const r=await f.login();const req={headers:{cookie:'crew_session='+r.sid}};
 assert.throws(()=>f.auth.requireHost(req),e=>e.status===403);const ticket=f.auth.issue(r.sid);const result=f.auth.verifyTicket(ticket);assert.equal(result.user.canHost,false);assert.equal(result.user.twitchId,'456');
});
test('raw guest identities and forged JWTs fail server verification',async()=>{
 const f=fixture();const r=await f.login();assert.throws(()=>f.auth.verifyTicket('guest-uuid'),e=>e.status===401);
 const parts=f.auth.issue(r.sid).split('.');const payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.sub=identity('456');parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');assert.throws(()=>f.auth.verifyTicket(parts.join('.')),e=>e.status===401);
});
test('mutation requires same configured origin and session CSRF',async()=>{
 const f=fixture();const r=await f.login();assert.throws(()=>f.auth.mutation({headers:{origin:'https://evil.example','x-csrf-token':r.session.csrf}},r.session),e=>e.status===403);assert.throws(()=>f.auth.mutation({headers:{origin:'http://localhost:9120'}},r.session),e=>e.status===403);
 f.auth.mutation({headers:{origin:'http://localhost:9120','x-csrf-token':r.session.csrf}},r.session);
});
test('logout revokes tickets and emits disconnect notice',async()=>{
 const f=fixture();const r=await f.login();const token=f.auth.issue(r.sid);let revoked=null;f.auth.onRevoke(sid=>revoked=sid);
 const cookie=f.auth.logout({headers:{cookie:'crew_session='+r.sid,origin:'http://localhost:9120','x-csrf-token':r.session.csrf}});assert.match(cookie,/Max-Age=0/);assert.equal(revoked,r.sid);assert.throws(()=>f.auth.verifyTicket(token),e=>e.status===401);
});
test('expired ticket and expired cookie session both reject',async()=>{
 const f=fixture();const r=await f.login();const token=f.auth.issue(r.sid);f.advance(901000);assert.throws(()=>f.auth.verifyTicket(token),e=>e.status===401);f.advance(14400000);assert.throws(()=>f.auth.session({headers:{cookie:'crew_session='+r.sid}}),e=>e.status===401);
});

test('admitted sockets survive ticket expiry but never session expiry or logout',async()=>{
 const f=fixture();const r=await f.login();const token=f.auth.issue(r.sid);f.advance(901000);
 assert.throws(()=>f.auth.verifyTicket(token),e=>e.status===401);
 assert.equal(f.auth.verifyTicket(token,{admittedSocket:true}).user.twitchId,'123');
 f.auth.revoke(r.sid);assert.throws(()=>f.auth.verifyTicket(token,{admittedSocket:true}),e=>e.status===401);
 const s=await f.login();const other=f.auth.issue(s.sid);f.advance(14400001);
 assert.throws(()=>f.auth.verifyTicket(other,{admittedSocket:true}),e=>e.status===401);
});
test('periodic Twitch revocation removes signed-in session',async()=>{
 const f=fixture();const r=await f.login();const token=f.auth.issue(r.sid);f.advance(3600001);f.auth.fetcher=async()=>({ok:false});await assert.rejects(f.auth.validate(r.sid),e=>e.status===401);assert.throws(()=>f.auth.verifyTicket(token),e=>e.status===401);
});
test('non-loopback HTTP configuration rejected; HTTPS cookies secure',()=>{
 assert.throws(()=>new TwitchAuth({origin:'http://public.example'}));const a=new TwitchAuth({origin:'https://game.example'});assert.match(a.cookie('crew_session','fixture',100),/HttpOnly.*SameSite=Lax.*Secure/);
});
