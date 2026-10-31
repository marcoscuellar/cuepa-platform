const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../assets/room-model.js');
async function boot(failed=false) {
 const elements=new Map();
 function el(id) {
  if(!elements.has(id)) elements.set(id,{id,hidden:false,dataset:{},value:'',textContent:'',innerHTML:'',tagName:'DIV',children:[],listeners:{},setAttribute(k,v){this[k]=v},addEventListener(k,v){this.listeners[k]=v},appendChild(v){this.children.push(v)},contains(){return false},focus(){},scrollIntoView(){}});
  return elements.get(id);
 }
 const now=new Date();now.setHours(14,0,0,0);
 const event={id:'meeting-1',title:'Planning <meeting>',start:{dateTime:now.toISOString()},calendar:'Team',who:['Chris'],notes:'Bring agenda'};
 const calls=[];
 const doc={body:{dataset:{ws:'cirques-experience',owner:'Chris'}},documentElement:{dataset:{}},activeElement:{tagName:'BODY'},getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:()=>el('created-'+elements.size)};
 const context={window:{CuepaRoomModel:model},document:doc,Date,URL,URLSearchParams,Blob,Promise,innerWidth:1440,setTimeout:()=>0,clearTimeout(){},setInterval(){},localStorage:{getItem:()=> 'done',setItem(){}},location:{replace(){throw Error('unexpected redirect')}},fetch:async url=>{
  calls.push(url);
  let body;
  if(url.includes('google')) body=url.includes('action=status')?{connected:true,selected:['one']}:{events:[event]};
  if(url.includes('gmail')) body=url.includes('action=status')?{connected:true,email:'owner@example.test'}:{messages:[{unread:true,from:'Sender',subject:'Hello',date:now.toISOString()}]};
  if(url.includes('timecards')) body={team:[],cards:{},days:[]};
  return {ok:!failed,status:failed?503:200,json:async()=>failed?{error:'Unavailable'}:body};
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/room.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 return {el,calls};
}
test('live client renders agenda, opens prep, retains notes, and answers locally',async()=>{
 const {el,calls}=await boot();
 assert.match(el('agenda').innerHTML,/Planning &lt;meeting&gt;/);
 el('agenda').listeners.click({target:{closest:()=>({dataset:{meeting:'meeting-1'}})}});
 assert.match(el('panel').innerHTML,/Meeting preparation/);
 el('meetingNotes').value='Bring budget';el('meetingNotes').oninput.call(el('meetingNotes'));
 el('tabInbox').onclick();el('tabDetails').onclick();
 assert.match(el('panel').innerHTML,/Bring budget/);
 el('meetingFollowup').value='Confirm costs';el('followupForm').onsubmit({preventDefault(){}});
 assert.match(el('agenda').innerHTML,/Confirm costs/);
 el('tabAssistant').onclick();el('assistantInput').value='My calendar';
 const before=calls.length;el('assistantForm').onsubmit({preventDefault(){}});
 assert.equal(calls.length,before);
 assert.match(el('assistantMessages').children.at(-1).textContent,/Planning <meeting>/);
});
test('failed sources show unknown state throughout the rendered client',async()=>{
 const {el}=await boot(true);
 assert.match(el('update').innerHTML,/need/);
 assert.match(el('health').textContent,/Not fully checked/);
 assert.match(el('boxes').innerHTML,/Unread count unknown/);
 assert.doesNotMatch(el('boxes').innerHTML,/All clear|You’re all set/);
 assert.match(el('agenda').innerHTML,/unavailable/);
});
