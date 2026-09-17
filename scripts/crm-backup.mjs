import {emitKeypressEvents} from 'node:readline';
import {readBackupInput,sealBackup,openBackup,writeExclusive} from './lib/crm-backup.mjs';

function hiddenPrompt(label){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Run this command in your own interactive terminal.');
  process.stdout.write(label);emitKeypressEvents(process.stdin);const wasRaw=process.stdin.isRaw;process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{let value='';const finish=(error)=>{process.stdin.off('keypress',onKey);process.stdin.setRawMode(Boolean(wasRaw));process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
    const onKey=(str,k)=>{if(k?.ctrl&&k.name==='c'){finish(Error('Cancelled.'));return;}if(k?.name==='return'){finish();return;}if(k?.name==='backspace'){value=[...value].slice(0,-1).join('');return;}if(!k?.ctrl&&!k?.meta&&str&&!/[\x00-\x1f\x7f]/.test(str)&&value.length+str.length<=1024)value+=str;};process.stdin.on('keypress',onKey);
  });
}
async function main(){
  const [command,input,output]=process.argv.slice(2);
  if(!['seal','verify','restore'].includes(command)||!input||(command!=='verify'&&!output)||process.argv.length>(command==='verify'?4:5))throw Error('Usage: node scripts/crm-backup.mjs seal export.sql backup.nccrm | verify backup.nccrm | restore backup.nccrm restored.sql');
  if(command==='restore'&&!output.endsWith('.sql'))throw Error('Choose a new .sql file for recovery. This command never restores into a live database.');
  let passphrase=await hiddenPrompt('Backup passphrase (hidden; keep it in your password manager): ');
  try{if(command==='seal'){
      const confirmation=await hiddenPrompt('Repeat backup passphrase: ');if(passphrase!==confirmation)throw Error('Passphrases did not match.');
      const bytes=await readBackupInput(input),sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes),sealed=await sealBackup(sql,passphrase);bytes.fill(0);
      const verified=await openBackup(sealed,passphrase);await writeExclusive(output,sealed);
      console.log(JSON.stringify({result:'Encrypted backup created and restore-tested',tables:verified.metadata.tables.length,created_at:verified.metadata.created_at}));
    }else{const verified=await openBackup(await readBackupInput(input),passphrase);if(command==='restore')await writeExclusive(output,verified.sql);
      console.log(JSON.stringify({result:command==='restore'?'Recovery SQL created; keep this plaintext file private':'Encrypted backup restored in memory and verified',created_at:verified.metadata.created_at,tables:verified.metadata.tables}));}
  }finally{passphrase='';}
}
main().catch(error=>{const safe=/^(Usage:|Choose a new|Run this command|Cancelled|Passphrases|Use a backup|Backup verification|Unrecognised backup|This recovery tool)/.test(error.message);console.error(safe?error.message:'Backup operation failed. Check the input, passphrase and output path; existing files will not be overwritten.');process.exitCode=1;});
