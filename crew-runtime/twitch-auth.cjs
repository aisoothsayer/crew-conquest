'use strict';
const {randomBytes,createHash,generateKeyPairSync,sign,verify,timingSafeEqual}=require('node:crypto');
function deny(message,status=401){const error=new Error(message);error.status=status;throw error;}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function cookieValue(req,name){for(const part of (req.headers.cookie||'').split(';')){const [key,...value]=part.trim().split('=');if(key===name)return value.join('=');}return null;}
function identity(id){const b=createHash('sha256').update('danny-openfront:twitch:'+id).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;return b.toString('base64url');}
function publicUser(user,ownerId){return {twitchId:user.id,login:user.login,name:user.display_name||user.login,avatar:user.profile_image_url||'',canHost:user.id===ownerId};}
function safeReturnTo(value){
  if(typeof value!=='string'||value.length>250||!value.startsWith('/')||value.includes('\\'))return '/crew.html';
  const u=new URL(value,'https://crew.invalid');
  if(u.origin!=='https://crew.invalid'||u.hash||!/^\/(?:[a-z]\/)?(?:w[01]\/)?game\/[A-Za-z0-9]{8,10}$/.test(u.pathname))return '/crew.html';
  if([...u.searchParams.keys()].some(k=>k!=='lobby'&&k!=='s'))return '/crew.html';
  return u.pathname+'?lobby';
}
class TwitchAuth {
  constructor(config,{fetcher=fetch,now=Date.now}={}){
    const origin=new URL(config.origin);
    if(origin.origin!==config.origin||origin.username||origin.password)throw new Error('Use a plain configured origin without paths or credentials');
    if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))throw new Error('Non-loopback origins require HTTPS');
    if(config.ownerId&&!/^\d+$/.test(config.ownerId))throw new Error('Owner must be the numeric Twitch user ID');
    this.config=config;this.fetcher=fetcher;this.now=now;this.states=new Map();this.sessions=new Map();this.listeners=new Set();
    const keys=generateKeyPairSync('ed25519');this.privateKey=keys.privateKey;this.publicKey=keys.publicKey;
    this.issuer=config.origin;this.audience='danny-openfront';
  }
  get configured(){return !!(this.config.clientId&&this.config.clientSecret&&this.config.ownerId);}
  cookie(name,value,maxAge,path='/'){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}${this.config.origin.startsWith('https:')?'; Secure':''}`;}
  sweep(){const now=this.now();for(const [id,s] of this.states)if(s.expires<=now)this.states.delete(id);for(const [id,s] of this.sessions)if(s.expires<=now)this.revoke(id);}
  begin(returnTo){
    if(!this.configured)deny('Twitch sign-in needs this game’s app configuration.',503);
    this.sweep();if(this.states.size>=100)deny('Sign-in is busy. Try again shortly.',429);
    const state=randomBytes(32).toString('base64url'),browser=randomBytes(32).toString('base64url');
    this.states.set(state,{browser,returnTo:safeReturnTo(returnTo),expires:this.now()+600000});
    const url=new URL('https://id.twitch.tv/oauth2/authorize');
    for(const [key,value] of Object.entries({client_id:this.config.clientId,redirect_uri:this.config.origin+'/auth/callback',response_type:'code',scope:'',state}))url.searchParams.set(key,value);
    return {url:url.href,cookie:this.cookie('crew_oauth',browser,600,'/auth')};
  }
  async json(url,options={}){const r=await this.fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)deny('Twitch sign-in could not be verified. Please try again.',502);return r.json();}
  async callback(req,params){
    const state=params.get('state'),pending=this.states.get(state);this.states.delete(state);
    if(!pending||pending.expires<=this.now()||!equal(pending.browser,cookieValue(req,'crew_oauth')))deny('Sign-in expired or belongs to a different browser.',403);
    if(params.has('error')||!params.get('code'))deny('Sign-in was cancelled.',400);
    const token=await this.json('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,code:params.get('code'),grant_type:'authorization_code',redirect_uri:this.config.origin+'/auth/callback'})});
    if(typeof token.access_token!=='string')deny('Twitch did not issue a usable sign-in token.',502);
    const validation=await this.json('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+token.access_token}});
    if(validation.client_id!==this.config.clientId||!/^\d+$/.test(validation.user_id||'')||!Number.isFinite(validation.expires_in)||validation.expires_in<=0)deny('Twitch account validation failed.',403);
    const profile=await this.json('https://api.twitch.tv/helix/users',{headers:{Authorization:'Bearer '+token.access_token,'Client-Id':this.config.clientId}});
    const user=profile.data?.[0];if(!user||user.id!==validation.user_id||typeof user.login!=='string')deny('Twitch profile does not match the validated account.',403);
    this.sweep();if(this.sessions.size>=1000)deny('Game sign-in capacity reached.',503);
    const sid=randomBytes(32).toString('base64url');
    const session={user:publicUser(user,this.config.ownerId),subject:identity(user.id),csrf:randomBytes(24).toString('base64url'),expires:this.now()+Math.min(14400,validation.expires_in)*1000,token:token.access_token,validated:this.now()};
    this.sessions.set(sid,session);
    return {sid,session,returnTo:pending.returnTo,cookies:[this.cookie('crew_session',sid,Math.floor((session.expires-this.now())/1000)),this.cookie('crew_oauth','',0,'/auth')]};
  }
  session(req){this.sweep();const sid=cookieValue(req,'crew_session');const session=this.sessions.get(sid);if(!session)deny('Sign in with Twitch to play.');return {sid,session};}
  requireHost(req){const entry=this.session(req);if(!entry.session.user.canHost)deny('Only Danny can host this game.',403);return entry;}
  mutation(req,session){if(req.headers.origin!==this.config.origin||!equal(req.headers['x-csrf-token'],session.csrf))deny('Refresh this game page before trying again.',403);}
  issue(sid){const s=this.sessions.get(sid);if(!s||s.expires<=this.now())deny('Sign in again.');const now=Math.floor(this.now()/1000),exp=Math.min(now+900,Math.floor(s.expires/1000));
    const payload={iss:this.issuer,aud:this.audience,sub:s.subject,sid,jti:randomBytes(16).toString('base64url'),iat:now,exp,provider:'twitch',role:s.user.canHost?'crew-host':'crew-viewer'};
    const body=[{alg:'EdDSA',typ:'JWT'},payload].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    return body+'.'+sign(null,Buffer.from(body),this.privateKey).toString('base64url');
  }
  verifyTicket(ticket,{admittedSocket=false}={}){
    if(typeof ticket!=='string'||ticket.length>4096)deny('Invalid game ticket.');
    const parts=ticket.split('.');if(parts.length!==3)deny('Sign in with Twitch to play.');
    let header,payload;try{header=JSON.parse(Buffer.from(parts[0],'base64url'));payload=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{deny('Invalid game ticket.');}
    if(header.alg!=='EdDSA'||!verify(null,Buffer.from(parts[0]+'.'+parts[1]),this.publicKey,Buffer.from(parts[2],'base64url')))deny('Invalid game ticket signature.');
    this.sweep();const s=this.sessions.get(payload.sid);
    if(!s||payload.provider!=='twitch'||payload.iss!==this.issuer||payload.aud!==this.audience||payload.sub!==s.subject||!Number.isFinite(payload.exp)||(!admittedSocket&&payload.exp<=this.now()/1000))deny('Game ticket expired or was revoked.');
    return {sid:payload.sid,subject:s.subject,user:s.user,expires:s.expires,claims:payload};
  }
  async validate(sid){const s=this.sessions.get(sid);if(!s||s.expires<=this.now()){this.revoke(sid);deny('Sign in again.');}if(this.now()-s.validated<3600000)return;
    try{const v=await this.json('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+s.token}});if(v.client_id!==this.config.clientId||v.user_id!==s.user.twitchId||v.expires_in<=0)throw new Error('revoked');s.validated=this.now();s.expires=Math.min(s.expires,this.now()+v.expires_in*1000);}catch{this.revoke(sid);deny('Twitch sign-in expired. Sign in again.');}}
  revoke(sid){if(this.sessions.delete(sid))for(const fn of this.listeners)fn(sid);}
  onRevoke(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  logout(req){const {sid,session}=this.session(req);this.mutation(req,session);this.revoke(sid);return this.cookie('crew_session','',0);}
  publicKeys(){return {keys:[{...this.publicKey.export({format:'jwk'}),alg:'EdDSA',use:'sig'}]};}
}
module.exports={TwitchAuth,identity,publicUser,safeReturnTo};
