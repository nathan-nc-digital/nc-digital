import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
export function crmDatabase(t) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0001_create_jobs_table.sql','0002_create_job_notes_table.sql','0003_add_completed_at.sql','0015_crm.sql','0016_crm_workspace.sql','0017_crm_reliability.sql','0018_crm_undated_tasks.sql','0019_crm_saved_views.sql','0020_crm_tags.sql','0021_crm_confirmation_kind.sql','0008_website_audits.sql','0022_website_audit_share.sql','0023_website_audit_open_alerts.sql','0024_website_audit_rerun.sql','0010_analytics_reports.sql','0025_seo_clients.sql','0026_admin_insights.sql','0027_gsc_snapshot_history.sql'])sqlite.exec(readFileSync('migrations/'+file,'utf8'));
  t.after(()=>sqlite.close());
  return {sqlite,prepare(sql){const s=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return s.get(...this.args)||null;},async all(){return {results:s.all(...this.args)};},async run(){const r=s.run(...this.args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
