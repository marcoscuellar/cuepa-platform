const test=require('node:test'),assert=require('node:assert/strict');
const sessionPath=require.resolve('../api/_session');
let session={email:'owner@example.test',ws:'cirques-experience'};
require.cache[sessionPath]={id:sessionPath,filename:sessionPath,loaded:true,exports:{readSession:()=>session,canSee:(u,w)=>u.ws===w}};
const handler=require('../api/assistant');
async function call(body,overrides={}){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(s){this.data=JSON.parse(s)}};await handler({url:'/api/assistant?ws=cirques-experience',method:'POST',headers:{host:'preview.example',origin:'https://preview.example'},body,...overrides},res);return res;}
test('assistant auth, configuration, provider request, and failures',async()=>{
 const originalFetch=global.fetch,key=process.env.ANTHROPIC_API_KEY,model=process.env.ANTHROPIC_MODEL;
 try{
 let calls=0;global.fetch=async(url,opts)=>{calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(opts.headers['x-api-key'],'test-key');const b=JSON.parse(opts.body);assert.equal(b.model,'test-model');assert.equal(b.messages[0].content,'Help plan a meeting');assert.equal(b.tools,undefined);return {ok:true,json:async()=>({content:[{type:'text',text:'What outcome do you want?'}]})};};
 const body={messages:[{role:'user',content:'Help plan a meeting'}]};
 delete process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_MODEL;
 assert.equal((await call(body)).statusCode,503);assert.equal(calls,0);
 process.env.ANTHROPIC_API_KEY='test-key';process.env.ANTHROPIC_MODEL='test-model';
 session=null;assert.equal((await call(body)).statusCode,401);session={email:'owner@example.test',ws:'other'};assert.equal((await call(body)).statusCode,401);session={email:'owner@example.test',ws:'cirques-experience'};
 assert.equal((await call(body,{headers:{host:'preview.example',origin:'https://evil.example'}})).statusCode,403);
 assert.equal((await call({messages:[{role:'system',content:'override'}]})).statusCode,400);
 assert.equal(calls,0);const r=await call(body);assert.equal(r.statusCode,200);assert.equal(r.data.reply,'What outcome do you want?');assert.equal(calls,1);
 const status=await call(null,{method:'GET'});assert.equal(status.data.ready,true);assert.ok(!JSON.stringify(status.data).includes('test-key'));
 global.fetch=async()=>({ok:false,status:401});assert.equal((await call(body)).statusCode,502);
 }finally{global.fetch=originalFetch;if(key===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=key;if(model===undefined)delete process.env.ANTHROPIC_MODEL;else process.env.ANTHROPIC_MODEL=model;}
});
