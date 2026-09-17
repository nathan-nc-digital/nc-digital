import {scrypt,randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {createReadStream} from 'node:fs';
import {open} from 'node:fs/promises';
import {inspectSql} from './crm-recovery.mjs';
const derive=promisify(scrypt),MAGIC=Buffer.from('NCDCRM1\n'),MAX_BYTES=128*1024*1024;
const digest=data=>createHash('sha256').update(data).digest('hex');
async function key(passphrase,salt){if(typeof passphrase!=='string'||passphrase.length<16||passphrase.length>1024)throw Error('Use a backup passphrase between 16 and 1024 characters.');return derive(passphrase,salt,32,{N:131072,r:8,p:1,maxmem:192*1024*1024});}
export async function readBackupInput(path){let total=0;const chunks=[];for await(const chunk of createReadStream(path)){total+=chunk.length;if(total>MAX_BYTES)throw Error('This recovery tool supports files up to 128 MiB.');chunks.push(chunk);}return Buffer.concat(chunks);}
export async function sealBackup(sql,passphrase){
  const bytes=Buffer.from(sql,'utf8');if(!bytes.length||bytes.length>MAX_BYTES-64000)throw Error('The SQL export is empty or too large.');
  const inspection=inspectSql(sql),metadata={version:1,created_at:new Date().toISOString(),sha256:digest(bytes),...inspection};
  const plain=Buffer.concat([Buffer.from(JSON.stringify(metadata)+'\n'),bytes]);
  const salt=randomBytes(16),iv=randomBytes(12),header=Buffer.concat([MAGIC,salt,iv]),secret=await key(passphrase,salt);
  try{const cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([header,cipher.getAuthTag(),encrypted]);}
  finally{secret.fill(0);plain.fill(0);bytes.fill(0);}
}
export async function openBackup(packageBytes,passphrase){
  if(packageBytes.length<60||packageBytes.length>MAX_BYTES||!packageBytes.subarray(0,8).equals(MAGIC))throw Error('Unrecognised backup format.');
  const header=packageBytes.subarray(0,36),secret=await key(passphrase,packageBytes.subarray(8,24));let plain;
  try{const decipher=createDecipheriv('aes-256-gcm',secret,packageBytes.subarray(24,36));decipher.setAAD(header);decipher.setAuthTag(packageBytes.subarray(36,52));plain=Buffer.concat([decipher.update(packageBytes.subarray(52)),decipher.final()]);
    const split=plain.indexOf(10);if(split<0||split>64000)throw Error('Invalid manifest.');const metadata=JSON.parse(plain.subarray(0,split).toString('utf8')),bytes=plain.subarray(split+1);
    if(metadata.version!==1||metadata.sha256!==digest(bytes))throw Error('Backup checksum mismatch.');
    const sql=bytes.toString('utf8'),inspection=inspectSql(sql);if(JSON.stringify(inspection.tables)!==JSON.stringify(metadata.tables))throw Error('Restored row counts differ from the backup manifest.');
    return {sql,metadata};
  }catch{throw Error('Backup verification failed. Check the file and passphrase.');}
  finally{secret.fill(0);plain?.fill(0);}
}
export async function writeExclusive(path,bytes){const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}
