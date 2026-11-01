const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const root=require.resolve('../api/_session');
function handler(name, session) {
 require.cache[root]={id:root,filename:root,loaded:true,exports:{readSession:()=>session,canSee:(s,ws)=>!!s&&s.ws===ws}};
 delete require.cache[require.resolve('../api/'+name)];
 return require('../api/'+name);
}
async function call(name,session) {
 const res={statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k]=v},end(value){this.body=value||''}};
 await handler(name,session)({url:'/api/'+name+'?ws=cirques-experience'+(name==='gmail'?'&action=page':'')+(name==='room'?'&room=1':''),headers:{host:'preview.example'},method:'GET'},res);
 return res;
}
const session={ws:'cirques-experience',name:'Chris',email:'owner@example.test'};
for(const name of ['room','today','gmail','hub','start']) {
 test(name+' keeps authenticated navigation, theme, and valid page scripts',async()=>{
  const response=await call(name,session);
  assert.equal(response.statusCode,200);
  const html=response.body;
  assert.equal((html.match(/class="cuepa-header"/g)||[]).length,1);
  assert.match(html,/href="\/assets\/workspace.css"/);
  for(const route of ['/cirques-experience/today','/cirques-experience/inbox','/cirques-experience/hub#calendar','/cirques-experience/hub#timecards','/cirques-experience/hub#vendors','/cirques-experience/hub#meetings','/cirques-experience/hub#connect','/cirques-experience/hub#access']) assert.ok(html.includes('href="'+route+'"'),route);
  for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.doesNotMatch(html,/<a[^>]+href="https:\/\/app\.makingcuepa\.com/);
 });
 test(name+' still rejects signed-out access',async()=>{
  const r=await call(name,null);assert.equal(r.statusCode,302);assert.match(r.headers.Location,/^\//);
 });
}
test('shared navigation follows hub sections without leaving the preview origin',()=>{
 const listeners={}; const attrs={};const link={dataset:{cuepaView:'timecards'},setAttribute(k,v){attrs[k]=v},removeAttribute(k){delete attrs[k]}};
 const context={location:{hash:'#calendar'},window:{addEventListener(k,f){listeners[k]=f}},document:{body:{dataset:{workspacePage:'hub'}},querySelectorAll:selector=>selector==='[data-cuepa-view]'?[link]:[]}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/workspace-nav.js'),'utf8'),context);
 assert.equal(attrs['aria-current'],undefined);context.location.hash='#timecards';listeners.hashchange();assert.equal(attrs['aria-current'],'page');
});

test('Today is the home page for now: /<ws> goes to /<ws>/today',async()=>{
 const res={statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k]=v},end(v){this.body=v||''}};
 await handler('room',session)({url:'/api/room?ws=cirques-experience',headers:{host:'preview.example'},method:'GET'},res);
 assert.equal(res.statusCode,302);assert.equal(res.headers.Location,'/cirques-experience/today');
});
test('The Room is not in the menu while Today is home',()=>{
 delete require.cache[require.resolve('../lib/workspace-ui')];
 const html=require('../lib/workspace-ui').header('cirques-experience','Cirques Experience','today');
 assert.doesNotMatch(html,/>The Room</);assert.match(html,/>Today</);
});
