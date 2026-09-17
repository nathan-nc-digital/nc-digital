import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
const credentials=JSON.parse(fs.readFileSync('scripts/gsc-credentials.json','utf8')),client=credentials.installed||credentials.web;
const redirect='http://127.0.0.1:3457',state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/analytics.readonly',access_type:'offline',prompt:'consent',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
let busy=false;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 const callback=new URL(req.url,redirect);
 if(callback.pathname!=='/'||callback.searchParams.get('state')!==state||busy){res.writeHead(400);res.end('Invalid sign-in callback.');return;}
 busy=true;
 try{
  if(callback.searchParams.get('error'))throw new Error('Google sign-in was cancelled.');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,code:callback.searchParams.get('code')||'',code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(20000)});
  const tokens=await r.json();if(!r.ok||!tokens.refresh_token||!tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/analytics.readonly'))throw new Error('Read-only Analytics permission was not granted. Run the connection helper again.');
  fs.writeFileSync('scripts/ga-token.json',JSON.stringify({...tokens,expiry_date:Date.now()+tokens.expires_in*1000},null,2));
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>Analytics connected</title><body style="font-family:Arial;padding:50px"><h1>Google Analytics connected</h1><p>You can close this tab and return to NC Digital.</p></body>');console.log('Analytics permission granted; connection saved privately.');server.close();clearTimeout(timer);
 }catch(e){res.writeHead(400,{'Content-Type':'text/plain'});res.end(e.message);console.log('Analytics sign-in did not complete.');busy=false;}
});
server.listen(3457,'127.0.0.1',()=>{fs.mkdirSync('.tmp',{recursive:true});fs.writeFileSync('.tmp/ga-auth-url.txt',url.href);console.log('Analytics sign-in ready. Waiting for Google consent.');});
server.on('error',e=>{console.log('Local sign-in could not start: '+e.code);clearTimeout(timer);process.exitCode=1;});
const timer=setTimeout(()=>{console.log('Analytics sign-in window timed out.');server.close();},30*60*1000);
