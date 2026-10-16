'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('./server.cjs');
test('public betting roster is read-only, fresh, and distinguishes an empty room from unavailable workers',async()=>{
 let room=null,unavailable=false;
 const app=createServer({origin:'http://localhost:9000'},{bettingRoster:async()=>{if(unavailable)throw Error('Unavailable');return room;}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{let r=await fetch(base+'/betting-roster');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');let d=await r.json();assert.equal(d.room,null);assert.equal(d.kind,'crew');assert.ok(Math.abs(Date.now()-d.observedAt)<1000);
 room={roomId:'AbCd1234',gameId:'AbCd1234:12345',phase:'lobby',players:[{key:'player-one',participant:'player-one',name:'One',computer:false}]};d=await fetch(base+'/betting-roster').then(r=>r.json());assert.deepEqual(d.room,room);assert.equal((await fetch(base+'/betting-roster',{method:'POST'})).status,404);
 unavailable=true;assert.equal((await fetch(base+'/betting-roster')).status,500);
 }finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});
