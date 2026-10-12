'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../openfront-source/OpenFrontIO-main/resources/sounds');
function wav(file,seconds,notes,volume){
 const rate=22050,n=Math.round(rate*seconds),b=Buffer.alloc(44+n*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++){const t=i/rate,step=seconds/notes.length,phase=(t%step)/step,f=notes[Math.floor(t/step)%notes.length],edge=Math.min(1,t/.3,(seconds-t)/.3),envelope=Math.sin(Math.PI*phase)**2; const s=(Math.sin(t*f*Math.PI*2)+.25*Math.sin(t*f*2*Math.PI*2))*.5*volume*envelope*edge;b.writeInt16LE(Math.round(s*32767),44+i*2);}
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b);
}
wav(path.join(root,'music/crew-lobby.wav'),12,[130.81,196,261.63,164.81,220,329.63,196,261.63],.12);
wav(path.join(root,'music/crew-ambient.wav'),16,[110,164.81,220,146.83,196,293.66,130.81,196],.1);
wav(path.join(root,'effects/crew-alert.wav'),.7,[523.25,659.25,783.99],.22);
console.log('Three original Crew audio assets generated.');
