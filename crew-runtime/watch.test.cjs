'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('one OBS URL follows new matches, verifies frame readiness, retries failed loading and returns to standby',async()=>{
  let match=null,now=1000;const listeners={};
  const stage={children:[],innerHTML:'standby',replaceChildren(...children){this.children=children;this.innerHTML='';}},status={textContent:''};
  const context={Date:{now:()=>now},AbortSignal,location:{origin:'https://crew.example'},setInterval:()=>0,
    fetch:async()=>({ok:true,json:async()=>match}),window:{addEventListener:(type,fn)=>{listeners[type]=fn;}},
    document:{getElementById:id=>id==='stage'?stage:id==='status'?status:stage.children.find(c=>c.id===id),createElement:tag=>({tag,style:{},contentWindow:{},remove(){stage.children=stage.children.filter(c=>c!==this);}})}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('./watch.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));assert.match(status.textContent,/Waiting/);
  match={gameID:'AbCd1234',path:'/w0/game/AbCd1234',map:'USA',live:true};await context.poll();let frame=stage.children[0];
  assert.equal(frame.src,'/w0/game/AbCd1234?spectate&obs=1');assert.equal(frame.style.visibility,'hidden');
  listeners.message({origin:'https://other.example',source:frame.contentWindow,data:{type:'crew-match-ready',gameID:match.gameID}});assert.equal(frame.style.visibility,'hidden');
  listeners.message({origin:context.location.origin,source:frame.contentWindow,data:{type:'crew-match-ready',gameID:match.gameID}});assert.equal(frame.style.visibility,'visible');
  match={...match,gameID:'NewGame1',path:'/w0/game/NewGame1'};await context.poll();assert.notEqual(stage.children[0],frame);frame=stage.children[0];
  now+=61000;await context.poll();assert.notEqual(stage.children[0],frame);
  match=null;await context.poll();assert.match(stage.innerHTML,/standby/);assert.match(status.textContent,/Waiting/);
});
