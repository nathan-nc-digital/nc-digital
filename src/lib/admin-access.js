import {createRemoteJWKSet, customFetch, jwtVerify} from 'jose';
import {limitedText} from './crm.js';

// Only public verification keys are cached. Never cache identities or bearer tokens.
let cachedKeys;
export function accessEnabled(env) {return env.ADMIN_AUTH_MODE==='access';}
export function accessSettings(env) {
  const issuer=String(env.ACCESS_TEAM_DOMAIN||'').replace(/\/$/,'');
  const audience=String(env.ACCESS_AUD||'').trim();
  const nathan=String(env.ACCESS_NATHAN_EMAIL||'').trim().toLowerCase();
  const ben=String(env.ACCESS_BEN_EMAIL||'').trim().toLowerCase();
  const maxAge=Number(env.ACCESS_MAX_SESSION_SECONDS||28800);
  const revokedBefore=Number(env.ACCESS_REVOKE_BEFORE||0);
  if(!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)||!audience||audience.length>512||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nathan)||(ben&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ben)||ben===nathan))||
    !Number.isInteger(maxAge)||maxAge<300||maxAge>86400||!Number.isSafeInteger(revokedBefore)||revokedBefore<0)throw Error('Invalid Access configuration');
  return {issuer,audience,nathan,ben,maxAge,revokedBefore};
}
async function fetchPublicKeys(url,options) {
  const response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(response.status!==200){await response.body?.cancel();throw Error('Public keys unavailable');}
  const body=await limitedText(response,64000);
  return new Response(body,{status:200,headers:{'Content-Type':'application/json'}});
}
export async function resolveAccessRole(request,env) {
  const settings=accessSettings(env);
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token||token.length>16000)return null;
  if(cachedKeys?.issuer!==settings.issuer)cachedKeys={issuer:settings.issuer,keys:createRemoteJWKSet(new URL(settings.issuer+'/cdn-cgi/access/certs'),{cacheMaxAge:300000,cooldownDuration:30000,timeoutDuration:5000,[customFetch]:fetchPublicKeys})};
  try{
    const {payload}=await jwtVerify(token,cachedKeys.keys,{issuer:settings.issuer,audience:settings.audience,algorithms:['RS256'],requiredClaims:['sub','email','iat','exp'],maxTokenAge:settings.maxAge,clockTolerance:5});
    if(typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string'||payload.iat<settings.revokedBefore)return null;
    const email=payload.email.toLowerCase(),pathname=new URL(request.url).pathname;
    if(email===settings.nathan)return 'nathan';
    if(settings.ben&&email===settings.ben&&(pathname==='/admin/jobs'||pathname.startsWith('/admin/jobs/')))return 'ben';
    return null;
  }catch{return null;}
}
export function accessDenied(configurationError=false) {
  return Response.json({error:configurationError?'Admin sign-in is not configured correctly.':'Sign in through NC Digital’s managed login to continue.'},{status:configurationError?503:401,headers:{'Cache-Control':'no-store, private','Cloudflare-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
