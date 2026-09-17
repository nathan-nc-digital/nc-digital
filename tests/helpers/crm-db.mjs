import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
export function crmDatabase(t) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0001_create_jobs_table.sql','0002_create_job_notes_table.sql','0003_add_completed_at.sql','0015_crm.sql','0016_crm_workspace.sql','0017_crm_reliability.sql','0018_crm_undated_tasks.sql','0019_crm_saved_views.sql','0020_crm_tags.sql'])sqlite.exec(readFileSync('migrations/'+file,'utf8'));
  t.after(()=>sqlite.close());
  return {sqlite,prepare(sql){const s=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return s.get(...this.args)||null;},async all(){return {results:s.all(...this.args)};},async run(){const r=s.run(...this.args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
