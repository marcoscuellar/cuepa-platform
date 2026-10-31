const crypto = require('node:crypto');
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
function fail(status, message) { return Object.assign(new Error(message), {status}); }
function config() {
  const {GOOGLE_CLIENT_ID:clientId, GOOGLE_CLIENT_SECRET:clientSecret, GOOGLE_REDIRECT_URI:redirectUri, AUTH_SECRET:secret}=process.env;
  if (!clientId || !clientSecret || !redirectUri || !secret || secret.length < 32) throw fail(503,'Calendar connection is not configured. Contact CUEPA.');
  const url=new URL(redirectUri);
  if(url.protocol!=='https:' || url.pathname!=='/api/google/callback' || url.search || url.hash) throw fail(503,'Calendar callback configuration needs attention.');
  return {clientId,clientSecret,redirectUri,origin:url.origin,secret};
}
function key() { return crypto.hkdfSync('sha256',config().secret,'cuepa-calendar-v1','encrypted-connections',32); }
function seal(value,context) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from(context));
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');
}
function unseal(value,context) {
  const [iv,tag,data]=String(value).split('.').map(x=>Buffer.from(x,'base64url'));
  const cipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(context));cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'));
}
function storageKey(s,ws) { return 'google-connections/'+crypto.createHash('sha256').update(JSON.stringify([ws,s.email.toLowerCase()])).digest('hex')+'.json'; }
async function read(s,ws) {
  const {get}=await import('@vercel/blob');const path=storageKey(s,ws);
  const r=await get(path,{access:'private',useCache:false});
  if(!r)return null;
  if(r.statusCode!==200 || !r.stream) throw fail(503,'Calendar storage is unavailable. Try again.');
  return unseal(await new Response(r.stream).text(),path);
}
async function write(s,ws,value) {
  const {put}=await import('@vercel/blob'); const path=storageKey(s,ws);
  await put(path,seal(value,path),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'text/plain'});
}
async function remove(s,ws) { const {del}=await import('@vercel/blob');await del(storageKey(s,ws)); }
async function token(params) {
  const c=config();
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,...params}),signal:AbortSignal.timeout(15000)});
  const data=await r.json();
  if(!r.ok) throw fail(data.error==='invalid_grant'?401:502,data.error==='invalid_grant'?'Google access expired or was revoked. Reconnect your calendar.':'Google could not complete authorization. Try connecting again.');
  return data;
}
async function access(record) {
  // Do not write refreshed access tokens: concurrent reads must never resurrect a disconnected connection.
  const t=await token({grant_type:'refresh_token',refresh_token:record.refreshToken});return t.access_token;
}
async function request(accessToken,path,params={}) {
  const url=new URL('https://www.googleapis.com/calendar/v3/'+path);
  for(const [k,v] of Object.entries(params))if(v!==undefined)url.searchParams.set(k,v);
  const r=await fetch(url,{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw fail(r.status===401?401:502,r.status===401?'Google access expired. Reconnect your calendar.':r.status===403?'Google denied calendar access. Check your approved permissions.':r.status===429?'Google is busy. Please try again shortly.':'Could not retrieve calendar data. Try again.');
  return r.json();
}
async function calendars(accessToken) {
  const items=[];let pageToken;
  do {const r=await request(accessToken,'users/me/calendarList',{maxResults:250,pageToken});items.push(...(r.items||[]));pageToken=r.nextPageToken;if(items.length>5000)throw fail(422,'Too many calendars to list. Contact CUEPA.');}while(pageToken);
  return items.filter(c=>!c.deleted && c.accessRole!=='freeBusyReader').map(c=>({id:c.id,name:c.summaryOverride||c.summary||c.id,primary:!!c.primary,timeZone:c.timeZone}));
}
// Google's 11 event colors (colorId 1-11), the same ones people pick in Google Calendar.
const EVENT_COLORS={1:'#7986cb',2:'#33b679',3:'#8e24aa',4:'#e67c73',5:'#f6c026',6:'#f5511d',7:'#039be5',8:'#616161',9:'#3f51b5',10:'#0b8043',11:'#d60000'};
async function calendarColors(accessToken){
  try{const r=await request(accessToken,'users/me/calendarList',{maxResults:250});const m={};for(const c of r.items||[])m[c.id]=c.backgroundColor||'';return m;}catch(e){return {};}
}
async function events(accessToken,selected,start,end) {
  const out=[];const calColor=await calendarColors(accessToken);
  for(const c of selected){let pageToken;let count=0;
    do{const r=await request(accessToken,'calendars/'+encodeURIComponent(c.id)+'/events',{singleEvents:'true',orderBy:'startTime',timeMin:start,timeMax:end,maxResults:2500,pageToken});
      for(const e of r.items||[]){if(e.status!=='cancelled')out.push({id:c.id+':'+e.id,title:e.summary||'Busy',start:e.start,end:e.end,location:e.location||'',calendar:c.name,link:e.htmlLink||'',notes:String(e.description||'').replace(/<[^>]+>/g,'').slice(0,600),who:(e.attendees||[]).filter(a=>!a.self).map(a=>a.displayName||a.email).slice(0,8),color:EVENT_COLORS[e.colorId]||calColor[c.id]||''});}
      count+=(r.items||[]).length;pageToken=r.nextPageToken;
      if(pageToken && count>=10000)throw fail(422,'This calendar has too many events in this period. Choose a shorter date range.');
    }while(pageToken);
  }
  return out.sort((a,b)=>(a.start.dateTime||a.start.date).localeCompare(b.start.dateTime||b.start.date));
}
module.exports={SCOPE,fail,config,seal,unseal,storageKey,read,write,remove,token,access,calendars,events};
