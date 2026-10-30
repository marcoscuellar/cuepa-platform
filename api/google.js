const crypto=require('node:crypto');
const {readSession,canSee}=require('./_session');
const WORKSPACES=require('../lib/workspaces');
const g=require('../lib/google');
const COOKIE='cuepa_google_flow';
function cookie(value,age=600){return `${COOKIE}=${value}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
function json(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));}
function redirect(res,to){res.statusCode=302;res.setHeader('Location',to);res.end();}
async function body(req){
  if(req.body && typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){if(req.body.length>20000)throw g.fail(413,'Request is too large.');try{return JSON.parse(req.body);}catch{throw g.fail(400,'Invalid request.');}}
  let text='';for await(const c of req){text+=c;if(text.length>20000)throw g.fail(413,'Request is too large.');}try{return JSON.parse(text||'{}');}catch{throw g.fail(400,'Invalid request.');}
}
function workspace(s,ws){if(!WORKSPACES[ws] || !canSee(s,ws))throw g.fail(403,'You cannot access this workspace.');return ws;}
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const url=new URL(req.url,'https://local.invalid');
  const action=url.pathname.endsWith('/callback')?'callback':url.searchParams.get('action');
  let callbackWs;
  try{
    const s=readSession(req);if(!s || s.temp)throw g.fail(401,'Please sign in to CUEPA with your permanent password first.');
    const cfg=g.config();
    const methods={start:'GET',callback:'GET',status:'GET',calendars:'GET',events:'GET',select:'POST',disconnect:'POST'};
    if(!methods[action])throw g.fail(404,'Not found.');
    if(req.method!==methods[action]){res.setHeader('Allow',methods[action]);throw g.fail(405,'Method not allowed.');}
    if(req.method==='POST' && req.headers.origin!==cfg.origin)throw g.fail(403,'Please use your CUEPA website to change the connection.');
    if(action==='callback'){
      const raw=String(req.headers.cookie||'').split(/;\s*/).find(v=>v.startsWith(COOKIE+'='));
      res.setHeader('Set-Cookie',cookie('',0));
      let flow;try{flow=g.unseal(raw?raw.slice(COOKIE.length+1):'','oauth-flow');}catch{throw g.fail(400,'Connection attempt expired. Return to CUEPA and try again.');}
      const state=url.searchParams.get('state');
      if(!state || state!==flow.nonce || flow.email!==s.email || !Number.isFinite(flow.expires) || flow.expires<Date.now())throw g.fail(400,'Connection attempt expired. Return to CUEPA and try again.');
      callbackWs=workspace(s,flow.ws);
      if(url.searchParams.has('error'))return redirect(res,`/${callbackWs}?google=cancelled#connect`);
      const code=url.searchParams.get('code');if(!code)throw g.fail(400,'Google did not return an authorization code.');
      const t=await g.token({grant_type:'authorization_code',code,redirect_uri:cfg.redirectUri,code_verifier:flow.verifier});
      if(!String(t.scope||'').split(' ').includes(g.SCOPE))throw g.fail(403,'Read-only Calendar permission was not approved. Please reconnect and approve it.');
      if(!t.refresh_token)throw g.fail(400,'Google did not grant ongoing access. Please reconnect.');
      await g.calendars(t.access_token); // Confirm the grant works before replacing an existing connection.
      await g.write(s,callbackWs,{refreshToken:t.refresh_token,selected:[],connectedAt:new Date().toISOString()});
      return redirect(res,`/${callbackWs}?google=connected#connect`);
    }
    const ws=workspace(s,url.searchParams.get('ws')||'');
    if(action==='start'){
      if(req.headers['sec-fetch-site']==='cross-site')throw g.fail(403,'Start the connection from your CUEPA workspace.');
      const flow={ws,email:s.email,nonce:crypto.randomBytes(32).toString('base64url'),verifier:crypto.randomBytes(48).toString('base64url'),expires:Date.now()+600000};
      res.setHeader('Set-Cookie',cookie(g.seal(flow,'oauth-flow')));
      const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search=new URLSearchParams({client_id:cfg.clientId,redirect_uri:cfg.redirectUri,response_type:'code',scope:g.SCOPE,access_type:'offline',prompt:'consent select_account',state:flow.nonce,code_challenge:crypto.createHash('sha256').update(flow.verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
      return redirect(res,auth.toString());
    }
    const record=await g.read(s,ws);
    if(action==='status')return json(res,200,{connected:!!record,selected:record?.selected||[]});
    if(action==='disconnect'){
      // Remove this CUEPA user/workspace connection only. Google revocation could affect the same Google account in other workspaces.
      await g.remove(s,ws);return json(res,200,{connected:false});
    }
    if(!record)throw g.fail(409,'Connect your Google Calendar first.');
    if(action==='events' && !record.selected.length)return json(res,200,{events:[],syncedAt:null});
    const accessToken=await g.access(record);
    if(action==='calendars')return json(res,200,{calendars:await g.calendars(accessToken),selected:record.selected});
    if(action==='select'){
      const data=await body(req);
      if(!Array.isArray(data.ids) || data.ids.some(id=>typeof id!=='string') || new Set(data.ids).size!==data.ids.length || data.ids.length>10)throw g.fail(400,'Choose up to 10 calendars.');
      const available=await g.calendars(accessToken);const selected=data.ids.map(id=>available.find(c=>c.id===id));
      if(selected.some(c=>!c))throw g.fail(400,'A selected calendar is no longer available. Reload the list.');
      // Re-read so a stale selection request cannot restore a deleted or replaced connection.
      const latest=await g.read(s,ws);if(!latest || latest.refreshToken!==record.refreshToken)throw g.fail(409,'The connection changed. Reload and try again.');
      await g.write(s,ws,{...latest,selected});return json(res,200,{selected});
    }
    if(action==='events'){
      const from=new Date(url.searchParams.get('start')),to=new Date(url.searchParams.get('end'));
      if(!Number.isFinite(+from)||!Number.isFinite(+to)||to<=from||to-from>32*86400000)throw g.fail(400,'Choose a date range of 1 to 31 days.');
      const events=await g.events(accessToken,record.selected,from.toISOString(),to.toISOString());
      return json(res,200,{events,syncedAt:new Date().toISOString()});
    }
  }catch(e){
    // Never log provider payloads, codes, tokens, or cookie values.
    console.error('Calendar request failed',{action,status:e.status||500});
    if(action==='callback' && callbackWs)return redirect(res,`/${callbackWs}?google=failed#connect`);
    return json(res,e.status||500,{error:e.status?e.message:'Calendar service is unavailable. Please try again.'});
  }
};
