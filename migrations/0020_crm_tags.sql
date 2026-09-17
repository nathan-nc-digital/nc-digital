-- Additive CRM productivity upgrade. Apply after 0019 with a verified export.
-- Tags remain portable JSON so records can be exported without a join table.
ALTER TABLE crm_accounts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE crm_contacts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE crm_opportunities ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE crm_tickets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
CREATE INDEX crm_accounts_tags ON crm_accounts(tags);
CREATE INDEX crm_contacts_tags ON crm_contacts(tags);
CREATE INDEX crm_opportunities_tags ON crm_opportunities(tags);
CREATE INDEX crm_tickets_tags ON crm_tickets(tags);
INSERT INTO crm_state(key,value) VALUES('tags_schema','1');
