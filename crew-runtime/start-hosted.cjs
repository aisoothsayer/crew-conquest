'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {createGateway}=require('./gateway.cjs');
const source=process.env.CREW_SOURCE_ROOT||path.resolve(__dirname,'../game');
const origin=new URL(process.env.CREW_ORIGIN||'');
if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw new Error('Public Crew hosting requires HTTPS.');
for(const name of ['CREW_TWITCH_CLIENT_ID','CREW_TWITCH_CLIENT_SECRET','CREW_HOST_TWITCH_ID'])if(!process.env[name])throw new Error(name+' must be configured privately in the host environment.');
const workers=Number(process.env.NUM_WORKERS||1);if(!Number.isInteger(workers)||workers<1||workers>2)throw new Error('Crew candidate supports one or two workers.');
const revision=process.env.CREW_SOURCE_COMMIT||process.env.RENDER_GIT_COMMIT;
if(!/^[0-9a-f]{40}$/i.test(revision||''))throw new Error('Crew hosting requires the full source commit SHA.');
const env={...process.env,CREW_TWITCH_ONLY:'true',NODE_ENV:'production',CREW_BUILD_ID:'CREW-20261013-18',GIT_COMMIT:revision,GAME_ENV:'dev',NUM_WORKERS:String(workers),INSTANCE_LETTER:'a',INSTANCE_ID:'crew-conquest',DOMAIN:origin.host,API_DOMAIN:'',API_KEY:randomBytes(32).toString('hex'),TURNSTILE_SITE_KEY:'1x00000000000000000000AA',LOBBY_COORDINATOR:'off'};
delete env.GAME_HOST;delete env.SUBDOMAIN;delete env.GAME_DOMAIN;delete env.SITE_HOST;
const children=[];let closing=false;
function launch(args,cwd){const p=spawn(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});children.push(p);p.once('exit',stop);}
const gateway=createGateway({workers});
function stop(){if(closing)return;closing=true;gateway.close();for(const p of children){if(process.platform==='win32')spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else p.kill('SIGTERM');}setTimeout(()=>process.exit(),500);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
launch([path.join(__dirname,'server.cjs')],__dirname);
launch([path.join(source,'node_modules/tsx/dist/cli.mjs'),'src/server/Server.ts'],source);
gateway.listen(Number(process.env.PORT||10000),process.env.CREW_GATEWAY_BIND||'0.0.0.0',()=>console.log('Crew Conquest gateway ready. Private game/identity services remain loopback-only.'));
