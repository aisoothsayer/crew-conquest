'use strict';
const http=require('node:http');
const {TwitchAuth,cookieValue}=require('./twitch-auth.cjs');
const {randomBytes}=require('node:crypto');
function createServer(config,deps){
  const auth=new TwitchAuth(config,deps);
  async function currentMatch(){
    if(deps?.currentMatch)return deps.currentMatch();
    const matches=await Promise.all(Array.from({length:Number(process.env.NUM_WORKERS||1)},async(_,i)=>{
      try{const r=await fetch('http://127.0.0.1:'+(3001+i)+'/api/crew-observer/current',{headers:{'x-api-key':process.env.API_KEY||''},signal:AbortSignal.timeout(3000)});return r.ok?await r.json():null;}catch{return null;}
    }));
    return matches.filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt)[0]||null;
  }
  const server=http.createServer(async(req,res)=>{
    async function currentRoom(){
      if(deps?.currentRoom)return deps.currentRoom();
      const rooms=await Promise.all(Array.from({length:Number(process.env.NUM_WORKERS||1)},async(_,i)=>{
        try{const r=await fetch('http://127.0.0.1:'+(3001+i)+'/api/crew-entry/current',{headers:{'x-api-key':process.env.API_KEY||''},signal:AbortSignal.timeout(3000)});return r.ok?await r.json():null;}catch{return null;}
      }));
      return rooms.filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt)[0]||null;
    }
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try{
      const url=new URL(req.url,config.origin);
      if(req.method==='GET'&&url.pathname==='/entry-current')return json(200,await currentRoom());
      if(req.method==='GET'&&url.pathname==='/observer-current')return json(200,await currentMatch());
      if(req.method==='GET'&&url.pathname==='/observer-session'){
        const match=await currentMatch();
        if(!match?.live||match.gameID!==url.searchParams.get('gameID'))return json(404,{error:'No live match.'});
        const existing=cookieValue(req,'crew_observer');
        const viewerID=/^[A-Za-z0-9_-]{32}$/.test(existing||'')?existing:randomBytes(24).toString('base64url');
        res.setHeader('Set-Cookie',auth.cookie('crew_observer',viewerID,14400));
        return json(200,{token:auth.issueObserver(match.gameID,viewerID)});
      }
      if(req.method==='GET'&&url.pathname==='/'){
        const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Danny’s Twitch strategy game</title><style>body{background:#101827;color:#edf4ff;font:18px system-ui;max-width:650px;margin:10vh auto;padding:24px}a{color:#bfadff}p{line-height:1.6}</style><h1>Danny’s Twitch strategy game</h1><p>This private service verifies Twitch identities for the local Crew game.</p><p><a href="'+config.origin+'/crew.html">Open the Crew game</a></p></html>';
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);
      }
      if(req.method==='GET'&&url.pathname==='/health')return json(200,{service:'openfront-crew-identity',authConfigured:auth.configured});
      if(req.method==='GET'&&url.pathname==='/auth/login'){const r=auth.begin(url.searchParams.get('returnTo'));res.writeHead(302,{Location:r.url,'Set-Cookie':r.cookie});return res.end();}
      if(req.method==='GET'&&url.pathname==='/auth/callback'){const r=await auth.callback(req,url.searchParams);res.writeHead(303,{Location:r.returnTo, 'Set-Cookie':r.cookies});return res.end();}
      if(req.method==='GET'&&url.pathname==='/session'){const {sid,session}=auth.session(req);await auth.validate(sid);return json(200,{user:session.user,csrf:session.csrf,expires:session.expires,token:auth.issue(sid)});}
      if(req.method==='GET'&&url.pathname==='/users/@me'){const r=auth.verifyTicket((req.headers.authorization||'').replace(/^Bearer /,''));await auth.validate(r.sid);return json(200,{user:r.sid===null?null:{twitch:{id:r.user.twitchId,login:r.user.login,displayName:r.user.name,avatar:r.user.avatar}},player:{publicId:r.subject,adfree:true,unlimitedRanked:false,canCreatePublicLobbies:false,username:r.user.name,usernameBase:r.user.name,flares:[],friends:[],achievements:{singleplayerMap:[]},subscription:null}});}
      if(req.method==='POST'&&url.pathname==='/game-ticket'){const {sid,session}=auth.session(req);auth.mutation(req,session);await auth.validate(sid);return json(200,{token:auth.issue(sid)});}
      if(req.method==='POST'&&url.pathname==='/auth/logout'){res.setHeader('Set-Cookie',auth.logout(req));return json(200,{ok:true});}
      if(req.method==='GET'&&url.pathname==='/host-access'){const {session}=auth.requireHost(req);return json(200,{host:session.user.name});}
      if(req.method==='GET'&&url.pathname==='/game-access'){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const r=auth.verifyTicket(token);await auth.validate(r.sid);return json(200,{subject:r.subject,user:r.user,claims:r.claims});}
      // Only the server's already-admitted socket watcher uses this route.
      // A short admission ticket expiring does not evict a still-valid session.
      // New joins continue to require /game-access and a fresh ticket.
      if(req.method==='GET'&&url.pathname==='/game-watch'){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const r=auth.verifyTicket(token,{admittedSocket:true});await auth.validate(r.sid);return json(200,{subject:r.subject,user:r.user,claims:r.claims});}
      return json(404,{error:'Not found'});
    }catch(error){return json(error.status||500,{error:error.status?error.message:'Game service unavailable.'});}
  });
  return {server,auth};
}
if(require.main===module){const config={origin:process.env.CREW_ORIGIN||'http://localhost:9000',clientId:process.env.CREW_TWITCH_CLIENT_ID,clientSecret:process.env.CREW_TWITCH_CLIENT_SECRET,ownerId:process.env.CREW_HOST_TWITCH_ID};const {server}=createServer(config);server.listen(9120,'127.0.0.1',()=>console.log('Crew identity service: loopback port 9120; real sign-in requires app configuration'));}
module.exports={createServer};
