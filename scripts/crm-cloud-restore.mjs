// Verify and recover a cloud backup to a new local SQL file. Never writes to production.
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectSql} from './lib/crm-recovery.mjs';
const [input,output]=process.argv.slice(2);
if(!input||process.argv.length>4||(output&&!output.endsWith('.sql')))throw Error('Usage: node scripts/crm-cloud-restore.mjs backup.json.gz [new-recovery.sql]');
const compressed=await readFile(input);if(compressed.length>32*1024*1024)throw Error('Backup too large');
const backup=JSON.parse(gunzipSync(compressed,{maxOutputLength:64*1024*1024}));
assert.equal(backup.format,'nc-digital-sql-v1');assert.equal(createHash('sha256').update(backup.sql).digest('hex'),backup.sha256,'Backup checksum mismatch');
const restored=inspectSql(backup.sql);
assert.deepEqual(restored.tables,[...backup.tables].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),'Restored table counts differ');
if(output)await writeFile(output,backup.sql,{flag:'wx',mode:0o600});
console.log(JSON.stringify({result:output?'Verified recovery SQL created':'Cloud backup restored and verified in isolated SQLite',created_at:backup.created_at,tables:restored.tables.length,rows:restored.tables.reduce((n,t)=>n+t.rows,0),integrity:restored.integrity,foreign_keys:restored.foreign_keys},null,2));
