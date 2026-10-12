'use strict';
const http=require('node:http');
const {randomInt}=require('node:crypto');
const {inviteGate}=require('./invite-gate.cjs');
const {readFileSync}=require('node:fs');
const path=require('node:path');
function route(url,workers=1,websocket=false){
 const u=new URL(url,'http://localhost');
 if(/^\/(?:auth)(?:\/|$)/.test(u.pathname))return {port:9120,path:u.pathname+u.search};
 if(u.pathname.startsWith('/crew-api/'))return {port:9120,path:u.pathname.slice(9)+u.search};
 const w=u.pathname.match(/^\/(?:[a-z]\/)?w(\d+)(\/.*)?$/);
 if(w){const index=Number(w[1]);if(index>=workers)return null;
  if(!websocket&&/^\/game\/[A-Za-z0-9]{8,10}$/.test(w[2]||''))return {port:3000,path:'/crew-app-shell'};
  return {port:3001+index,path:(w[2]||'/')+u.search};}
 if(websocket)return u.pathname==='/lobbies'?{port:3000,path:url}:null;
 if(u.pathname==='/api/create_game'||u.pathname==='/api/matchmaking')return {port:3001+randomInt(workers),path:url};
 if(u.pathname==='/'||/^\/game\/[A-Za-z0-9]{8,10}$/.test(u.pathname))return {port:3000,path:'/crew-app-shell'};
 return {port:3000,path:url};
}
function createGateway({workers=1,identityOrigin='http://127.0.0.1:9120'}={}){
 const gate=inviteGate(identityOrigin);
 const server=http.createServer((req,res)=>{
  if(req.method==='GET'&&req.url?.split('?')[0]==='/watch/current'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(path.join(__dirname,'watch.html')));return;}
  if(req.url==='/health'){const upstream=http.request({hostname:'127.0.0.1',port:3000,path:'/api/health'},r=>{res.writeHead(r.statusCode,{'Content-Type':'application/json','Cache-Control':'no-store'});r.pipe(res);});upstream.on('error',()=>{res.writeHead(503);res.end('Starting Crew Conquest');});upstream.end();return;}
  gate(req,res,()=>{
   const target=route(req.url,workers);if(!target){res.writeHead(404);return res.end('Room route unavailable.');}
   const headers={...req.headers,host:'127.0.0.1:'+target.port};delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];
   const proxy=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
   proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain'});res.end('Crew Conquest is temporarily unavailable. Try again shortly.');});
   req.pipe(proxy);
  });
 });
 server.on('upgrade',(req,socket,head)=>{
  const target=route(req.url,workers,true);if(!target)return socket.destroy();
  const headers={...req.headers,host:'127.0.0.1:'+target.port};delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];
  const proxy=http.request({hostname:'127.0.0.1',port:target.port,path:target.path,headers});
  proxy.on('upgrade',(res,upstream,upstreamHead)=>{
   socket.write('HTTP/1.1 '+res.statusCode+' '+res.statusMessage+'\r\n'+Object.entries(res.headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');
   if(upstreamHead.length)socket.write(upstreamHead);if(head.length)upstream.write(head);
   socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
   socket.pipe(upstream).pipe(socket);
  });
  proxy.on('response',r=>{socket.end('HTTP/1.1 '+r.statusCode+' Rejected\r\nConnection: close\r\n\r\n');r.resume();});
  proxy.on('error',()=>socket.destroy());proxy.end();
 });
 return server;
}
module.exports={route,createGateway};
