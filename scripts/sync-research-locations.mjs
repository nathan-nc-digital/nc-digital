import fs from 'node:fs';
const vars = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
const response = await fetch('https://api.dataforseo.com/v3/serp/google/locations/gb', { headers: { Authorization: `Basic ${Buffer.from(`${vars.DATAFORSEO_LOGIN}:${vars.DATAFORSEO_PASSWORD}`).toString('base64')}` }, signal: AbortSignal.timeout(30000) });
const body = await response.json();
if (!response.ok || body.tasks?.[0]?.status_code !== 20000) throw new Error(`DataForSEO location check failed: HTTP ${response.status}, code ${body.tasks?.[0]?.status_code}`);
const locations = body.tasks[0].result.filter(x => x.country_iso_code === 'GB').map(x => ({ code: x.location_code, name: x.location_name, type: x.location_type }));
fs.writeFileSync('src/data/research-locations.json', JSON.stringify(locations));
console.log(JSON.stringify({ connected: true, locations: locations.length, example: locations.filter(x => /merthyr/i.test(x.name)) }));
