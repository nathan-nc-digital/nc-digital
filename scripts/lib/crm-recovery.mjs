import {DatabaseSync,constants} from 'node:sqlite';
const quote=name=>'"'+name.replaceAll('"','""')+'"';
export function restoredDatabase(sql) {
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,allowExtension:false,defensive:true});
  if(typeof db.setAuthorizer!=='function'){db.close();throw Error('Recovery checks require Node 24.14 or later.');}
  db.setAuthorizer((action,arg1,arg2)=>{
    if([constants.SQLITE_ATTACH,constants.SQLITE_DETACH,constants.SQLITE_CREATE_VTABLE].includes(action))return constants.SQLITE_DENY;
    if(action===constants.SQLITE_PRAGMA&&!['foreign_keys','defer_foreign_keys','user_version','application_id','quick_check','integrity_check','foreign_key_check'].includes(String(arg1).toLowerCase()))return constants.SQLITE_DENY;
    if(action===constants.SQLITE_FUNCTION&&['load_extension','readfile','writefile'].includes(String(arg2).toLowerCase()))return constants.SQLITE_DENY;
    return constants.SQLITE_OK;
  });
  try{db.exec(sql);db.setAuthorizer(null);if(db.isTransaction)db.exec('COMMIT');db.exec('PRAGMA foreign_keys=ON');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database integrity checks failed.');
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crm_tickets'").get()||!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crm_messages'").get())throw Error('The export does not contain the CRM tables.');
    return db;
  }catch(error){db.close();throw error;}
}
export function inspectSql(sql) {
  const db=restoredDatabase(sql);
  try{return {tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,rows:db.prepare('SELECT COUNT(*) AS count FROM '+quote(name)).get().count})),integrity:'ok',foreign_keys:'ok'};}
  finally{db.close();}
}
