'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {route}=require('./gateway.cjs');
test('public HTTP and socket routes select only their private fixed upstreams',()=>{
 assert.deepEqual(route('/auth/login?returnTo=room'),{port:9120,path:'/auth/login?returnTo=room'});
 assert.deepEqual(route('/crew-api/session'),{port:9120,path:'/session'});
 assert.deepEqual(route('/w0/game/Abcd1234?lobby'),{port:3000,path:'/crew-app-shell'});
 assert.deepEqual(route('/a/w0/api/game/Abcd1234'),{port:3001,path:'/api/game/Abcd1234'});
 assert.deepEqual(route('/w0',1,true),{port:3001,path:'/'});
 assert.deepEqual(route('/lobbies',1,true),{port:3000,path:'/lobbies'});
 assert.equal(route('/w1',1,true),null);assert.equal(route('/unknown',1,true),null);
});
