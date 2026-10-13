'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../game/resources/public/crew.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function page(user,room){
  const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{hidden:/hidden/.test(html.match(new RegExp('<[^>]+id="'+m[1]+'"[^>]*>'))?.[0]||''),textContent:'',href:''}]));
  const redirects=[];let nextRoom=room,periodic;
  const ctx=vm.createContext({document:{getElementById:id=>elements[id]},location:{replace:url=>redirects.push(url),reload:()=>{}},setInterval:fn=>periodic=fn,fetch:async url=>url.endsWith('/session')?{ok:!!user,status:user?200:401,json:async()=>({user,csrf:'test'})}:{ok:true,json:async()=>nextRoom}});
  vm.runInContext(script,ctx);await new Promise(setImmediate);
  return {elements,redirects,poll:async room=>{nextRoom=room;await periodic();}};
}
const open={gameID:'Abcd1234',path:'/w0/game/Abcd1234',canJoin:true,mode:'viewer-bots',map:'United States',players:1};
test('viewer authenticates once and enters current room without the creation menu; a closed round stays locked',async()=>{
  const guest=await page(null,open);assert.equal(guest.elements.host.hidden,true);assert.equal(guest.redirects.length,0);assert.match(guest.elements.join.href,/auth\/login/);
  const viewer=await page({name:'Viewer',canHost:false},open);assert.deepEqual(viewer.redirects,['/w0/game/Abcd1234?lobby']);assert.equal(viewer.elements.host.hidden,true);
  const locked=await page({name:'Viewer',canHost:false},{...open,canJoin:false,started:true});assert.equal(locked.redirects.length,0);assert.equal(locked.elements.watch.hidden,false);assert.equal(locked.elements.join.hidden,true);
});
test('host keeps separate creation controls and resume; idle viewers can play Solo or auto-join the next room',async()=>{
  const host=await page({name:'Danny',canHost:true},open);assert.equal(host.elements.host.hidden,false);assert.equal(host.redirects.length,0);assert.equal(host.elements.resume.href,'/w0/game/Abcd1234?lobby&host');
  const viewer=await page({name:'Viewer',canHost:false},null);assert.equal(viewer.elements.solo.href,'/?crewAction=solo');await viewer.poll(open);assert.deepEqual(viewer.redirects,['/w0/game/Abcd1234?lobby']);
  const malicious=await page({name:'Viewer',canHost:false},{...open,path:'https://external.test/game'});assert.equal(malicious.redirects.length,0);
});
test('entry discovery has no credential or account data',async()=>{
  const {createServer}=require('./server.cjs');const app=createServer({origin:'http://localhost:9000'},{currentRoom:async()=>open});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try{const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/entry-current');assert.equal(r.status,200);assert.deepEqual(await r.json(),open);assert.equal(r.headers.get('cache-control'),'no-store');}
  finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
});
