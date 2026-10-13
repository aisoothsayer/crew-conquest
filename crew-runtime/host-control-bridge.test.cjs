'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'host-control-client.js'),'utf8');
async function fixture(){
  const elements=Object.fromEntries(['identity','signin','open','start','end','mode','room','lobby','message','refresh','end-confirm','end-confirm-room','cancel-end','confirm-end'].map(id=>[id,{value:'active',addEventListener(name,fn){this[name]=fn;},textContent:'',hidden:false,disabled:false}]));
  const replies=[],requests=[],opener={postMessage:(data,origin)=>replies.push({data,origin})};let handler,room=null;
  const ctx=vm.createContext({document:{getElementById:id=>elements[id]},window:{opener,addEventListener:(name,fn)=>{handler=fn;},confirm:()=>true},crypto:{randomUUID},setInterval:()=>{},fetch:async(url,options)=>{
    if(url==='/crew-api/session')return {ok:true,status:200,json:async()=>({user:{canHost:true},csrf:'fixture-csrf'})};
    if(options?.method==='POST'){const body=JSON.parse(options.body);requests.push(body);if(body.action==='open')room={id:'Abcd1234',phase:'lobby',players:0,ready:0,canStart:false,lobbyUrl:'https://crew.test/w0/game/Abcd1234?lobby'};}
    return {ok:true,json:async()=>({signedIn:true,canHost:true,room})};
  }});
  vm.runInContext(source,ctx);await new Promise(setImmediate);
  const nonce=randomUUID();
  return {elements,requests,replies,opener,nonce,async send(action,overrides={},origin='https://dannyisstuckonline.com',eventSource=opener){const message={channel:'danny-game-control',version:1,game:'crew',nonce,id:randomUUID(),action,roomId:null,mode:'active',...overrides};handler({data:message,origin,source:eventSource});await new Promise(setImmediate);return message;}};
}
test('only the approved opener and first status handshake can bind a bridge',async()=>{const f=await fixture();await f.send('open');await f.send('status',{},'https://attacker.test');await f.send('status',{},'https://dannyisstuckonline.com',{});assert.equal(f.replies.length,0);assert.equal(f.requests.length,0);await f.send('status');assert.equal(f.replies.length,1);assert.equal(f.replies[0].origin,'https://dannyisstuckonline.com');await f.send('open',{nonce:randomUUID()});assert.equal(f.requests.length,0);});
test('duplicate bridge writes are cached and reused request IDs cannot change the action',async()=>{const f=await fixture();await f.send('status');const id=randomUUID();await f.send('open',{id});await f.send('open',{id});assert.equal(f.requests.length,1);await f.send('end',{id});assert.equal(f.requests.length,1);assert.equal(f.replies.at(-1).data.ok,false);assert.match(f.replies.at(-1).data.error,/different command/);const wire=JSON.stringify(f.replies);assert.doesNotMatch(wire,/fixture-csrf|fixture-token|"token"|"csrf"/);});
test('native site origin is accepted but cannot replace the original nonce binding',async()=>{const f=await fixture();await f.send('status',{},'https://ai-soothsayer.aisoothsayer.chatgpt.site');assert.equal(f.replies.length,1);await f.send('open');assert.equal(f.requests.length,0);await f.send('open',{},'https://ai-soothsayer.aisoothsayer.chatgpt.site');assert.equal(f.requests.length,1);});
test('standalone End requires explicit confirmation and retains the displayed target',async()=>{const f=await fixture();await f.send('status');await f.send('open');f.elements.end.click();assert.equal(f.elements['end-confirm'].hidden,false);assert.equal(f.requests.length,1);f.elements['cancel-end'].click();assert.equal(f.requests.length,1);f.elements.end.click();f.elements['confirm-end'].click();await new Promise(setImmediate);assert.equal(f.requests.length,2);assert.equal(f.requests[1].action,'end');assert.equal(f.requests[1].roomId,'Abcd1234');});
