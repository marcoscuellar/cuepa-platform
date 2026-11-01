const {readSession,canSee}=require('./_session');
const workspaces=require('../lib/workspaces');
const crypto=require('node:crypto');
const limits=new Map();
const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 const url=new URL(req.url,'https://local.invalid'),ws=url.searchParams.get('ws');
 let user;try{user=readSession(req);}catch{}
 if(!user||user.temp||!workspaces[ws]||!canSee(user,ws))return send(res,401,{error:'Sign in to this workspace to use the assistant.'});
 const ready=!!(process.env.ANTHROPIC_API_KEY&&process.env.ANTHROPIC_MODEL);
 if(req.method==='GET')return send(res,200,{ready,scope:crypto.createHash('sha256').update(ws+':'+user.email).digest('hex'),provider:'Anthropic',error:ready?null:'AI is not configured. Add ANTHROPIC_API_KEY and ANTHROPIC_MODEL to this deployment.'});
 if(req.method!=='POST')return send(res,405,{error:'Method not allowed.'});
 let origin;try{origin=new URL(req.headers.origin).host;}catch{}
 if(!origin||origin!==req.headers.host)return send(res,403,{error:'Request origin rejected.'});
 if(!ready)return send(res,503,{error:'AI is not configured. Add ANTHROPIC_API_KEY and ANTHROPIC_MODEL to this deployment.'});
 let payload;try{
  if(req.body&&typeof req.body==='object')payload=req.body;
  else {let raw=typeof req.body==='string'?req.body:'';if(!raw)for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32000)return send(res,413,{error:'Conversation is too long. Start a new chat.'});}payload=JSON.parse(raw);}
  if(Buffer.byteLength(JSON.stringify(payload))>32000)throw Error();
 }catch{return send(res,400,{error:'Invalid conversation.'});}
 const messages=payload.messages;
 if(!Array.isArray(messages)||!messages.length||messages.length>20||messages[0].role!=='user'||messages.at(-1).role!=='user'||messages.some((m,i)=>!m||m.role!==(i%2?'assistant':'user')||typeof m.content!=='string'||!m.content.trim()||m.content.length>6000))return send(res,400,{error:'Send a valid conversation of up to 20 messages.'});
 const now=Date.now(),key=ws+':'+user.email;
 for(const [k,v] of limits)if(now-v.at>60000)limits.delete(k);
 const limit=limits.get(key)||{at:now,count:0};if(limit.count>=12)return send(res,429,{error:'Please wait a minute before sending more messages.'});limit.count++;limits.set(key,limit);
 try{
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(25000),body:JSON.stringify({model:process.env.ANTHROPIC_MODEL,max_tokens:1200,system:'You are CUEPA, a practical and warm assistant for a business workspace. Help think through ideas, prepare meetings, draft text, and plan next steps. Only the conversation is available to you. You do not have access to the user’s email, calendar, timecards, files, or live business metrics. Say so when those are needed and ask the user to supply relevant details. Never invent operational facts or claim to have sent, approved, scheduled, or saved anything. You have no action tools. Keep responses concise and in English unless explicitly asked otherwise.',messages:messages.map(m=>({role:m.role,content:m.content}))})});
  if(!response.ok)return send(res,response.status===429?429:502,{error:response.status===429?'The AI provider is busy. Try again shortly.':'The AI provider could not respond. Check the server’s model, API key, and billing configuration.'});
  const data=await response.json(),reply=(data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(!reply)return send(res,502,{error:'The AI returned no text. Please try again.'});
  return send(res,200,{reply});
 }catch{return send(res,502,{error:'The AI connection timed out or failed. Your message was not answered. Please retry.'});}
};
