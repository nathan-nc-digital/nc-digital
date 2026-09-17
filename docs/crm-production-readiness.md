# CRM production preparation — 15 September 2026

This phase adds managed-login support, recoverable mailbox imports, delivery reconciliation and encrypted backup tooling. The reviewed Worker/assets release is deployed to production as version `b8c6df95-122e-46b1-993f-a0ab5e7270e7`, and migrations 0016–0019 are applied to D1. Cloudflare Access policy/MFA, scheduled off-site backups and a real recovery drill still require rollout. No real outbound emails were sent by this release.

## Managed login

`src/lib/admin-access.js` verifies Cloudflare Access JWTs with `jose` 6.2.12. It checks RS256 signatures against the team's public JWKS, exact issuer/audience, named email allowlists, expiry, required identity claims and maximum token age. Public keys alone are cached. Redirected key fetches, oversized responses and invalid configuration fail closed. `src/worker.js` enforces this before every admin handler, including direct Worker requests. In access mode, Basic credentials cannot bypass it. Nathan has admin access; Ben remains restricted to jobs.

Configuration contract (no actual credentials belong in this document):

| Variable | Meaning |
|---|---|
| `ADMIN_AUTH_MODE` | `access` activates managed login; unset or `basic` preserves existing login during preparation. Other values reject admin access. |
| `ACCESS_TEAM_DOMAIN` | Exact `https://TEAM.cloudflareaccess.com` issuer, without a path. |
| `ACCESS_AUD` | The Access application's audience identifier. |
| `ACCESS_NATHAN_EMAIL` | Exact permitted identity for Nathan. |
| `ACCESS_BEN_EMAIL` | Optional exact identity for Ben, jobs only. |
| `ACCESS_MAX_SESSION_SECONDS` | 300–86400 seconds; default 28800 (8 hours). Match the Access session policy. |
| `ACCESS_REVOKE_BEFORE` | Epoch seconds; tokens issued before this timestamp are refused. Default 0. |

Before activation, create an Access application covering `/admin` and `/admin/*` on every public hostname, restrict named identities, and require MFA through the configured identity provider. Test a separate staging deployment, including unknown users, Ben, an expired session and the direct Worker URL. Coordinate any admin scripts that currently use Basic authentication. Do not enable access mode until the matching policy and settings exist.

Cloudflare supplies the signed assertion; the application validates it rather than trusting a claimed email header. The CRM's AJAX requests set `X-Requested-With` for expired-session 401 responses. Mailbox health offers the Access logout link. On compromise, revoke sessions in Cloudflare and advance `ACCESS_REVOKE_BEFORE`; a browser logout alone is not global token revocation. Cloudflare login logs and alert retention must be configured operationally. Application-level MFA is not claimed until the identity policy is verified. See [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).

## Mailbox reliability

`migrations/0017_crm_reliability.sql` adds `crm_sync_items`, manual delivery-confirmation fields on `crm_messages`, and `crm_state.reliability_schema=1`. `migrations/0018_crm_undated_tasks.sql` then makes task due dates optional while preserving existing rows and relationship guards. `migrations/0019_crm_saved_views.sql` adds private validated saved views. `migrations/0020_crm_tags.sql` adds portable, indexed JSON tags to customers, contacts, opportunities and enquiries. These migrations were applied to production after a verified export and rehearsal.

`src/lib/crm-sync.js` records discovered reply IDs before advancing the scan cursor. Each scheduled run fetches at most eight message bodies, with bounded provider requests. During historical scans it also checks the latest page so new replies are not held behind old history. Failed bodies remain queued with exponential backoff; five unsuccessful attempts move an item to `needs_review`. One failure does not block other replies. Successfully imported message, task, ticket update and queue removal commit together. The full source is retained, while the inbox shows the trimmed reply. Only the ticket's matching customer email is associated automatically; attachments remain in Zoho.

`/admin/crm/?view=health` shows pending imports, retry status and outstanding outgoing messages. `/admin/crm/api/workspace/retry-import` creates an audit event and explicitly queues a selected import again. If the linked customer is archived, review/restore that relationship before retrying; relationship guards remain enforced. Provider request limits and saved retries reduce disruption but do not promise unlimited throughput. Search pagination still revisits historical messages over time. See [Zoho search parameters](https://www.zoho.com/mail/help/api/get-search-emails.html).

`/admin/crm/api/workspace/confirm-sent` resolves an ambiguous send only after the operator checks the exact message in Zoho Sent and supplies a confirmation plus evidence note. It uses the message's last-update value to reject stale changes, records the actor/note/time and an audit event, and advances a matching queued quote. It never contacts Zoho or resends the message. The inbox labels it **manually confirmed**, separately from a provider receipt. A newer inbound reply keeps the ticket open. Confirmation is evidence of a send, not proof of receipt. There is no automatic resend for unknown outcomes.

## Encrypted backups and recovery

Node **24.14 or later** is required for the recovery tools' SQLite authorizer. The main site's existing Node requirement is unchanged.

Run these commands in your own interactive terminal. The tool prompts for a hidden passphrase; keep it separately in a password manager. Supply an actual complete D1 SQL export, including the shared jobs data. The example paths are placeholders, not existing backups.

```powershell
node scripts/crm-backup.mjs seal .tmp\private-export.sql .tmp\crm-backup.nccrm
node scripts/crm-backup.mjs verify .tmp\crm-backup.nccrm
node scripts/crm-backup.mjs restore .tmp\crm-backup.nccrm .tmp\recovered.sql
node scripts/crm-migration-check.mjs .tmp\recovered.sql
```

Encryption uses AES-256-GCM with a random salt/nonce and scrypt-derived key. The encrypted manifest includes the export checksum, timestamp and row counts. Seal and verify rebuild the database in memory and check integrity and foreign keys. Recovery SQL cannot attach another database, load extensions, create virtual tables or enable unsafe PRAGMAs. Outputs are exclusive-create: an existing file is never overwritten. Recovery creates a **new SQL file**, never writes to D1. The current format supports files up to 128 MiB and rebuilds them in memory; larger exports need a separate streaming workflow.

The tool does not fetch production data, schedule exports, upload off-site copies or remove plaintext input/recovery files. The `.tmp` folder is ignored by Git, but is not an encrypted vault. Windows ACLs and disk encryption remain relevant; POSIX mode 0600 alone does not establish Windows access policy. Keep plaintext exports in private storage, remove them deliberately after successful recovery verification, and store encrypted backups independently of this computer. Losing the passphrase makes recovery impossible. This is backup tooling, **not an activated backup service**.

Recommended operational target: daily encrypted off-site copies, an export immediately before each migration, failure alerts, defined retention, and a monthly restore drill into an isolated database. Include restoration of the separate Worker configuration, deployment reference, secrets from the password manager and any R2 files. A SQL backup does not include those resources. Decide retention based on business recovery and data-protection needs.

## Migration and release sequence

1. Record the exact reviewed release. This workspace contains substantial unrelated uncommitted work; do not publish it indiscriminately.
2. Take and verify a complete private production export and restore it into an isolated environment. Run `crm-migration-check.mjs` against it. The checker detects pending 0016/0017/0018/0019, rejects partial schema flags, verifies original data and rehearses rollback in memory. Synthetic tests are not a live recovery drill.
3. Arrange a short maintenance window that pauses **public intake, admin writes and scheduled jobs** while the backup/migrations are coordinated. Simply setting `CRM_ENABLED=false` is not a global write lock. Provide a working fallback contact route. Apply only missing 0016, 0017, 0018 and 0019, in order, through the existing D1 migration process.
4. Deploy the matching Worker and static assets together. The core workspace, reliability, undated-task and saved-view migrations are required. Confirm live data counts/relationships and public capture before resuming writes. Retain the previous release; rollback application code while retaining additive tables. A database restore would discard later writes and affect other tools using this shared database.
5. Activate and verify managed login with the prepared Access policy. Check all hostnames, direct Worker access and required admin tools. Configure operational logs/alerts without recording tokens or unnecessary customer details.
6. With an explicitly authorised test recipient, verify first-form notification, outbound CRM reply, original context only on the first reply, incoming reply parsing, failed-import visibility and provider receipts. Inspect actual desktop/mobile email clients. No such real send happened in this phase.

## Dependency remediation completed locally

The dependency refresh upgraded Astro to **7.3.2** and updated the Astro integrations and affected transitive packages. `npm audit --omit=dev` and the full audit now report **0 vulnerabilities**. This clears the known Astro AVIF advisory (`GHSA-26w7-cxv4-gfx2`) in the reviewed local dependency graph; it does not replace release review or runtime verification.

The configured production site remains static (`astro.config.mjs`) and the deployed entrypoint is the custom Worker. The dependency lockfile, static bundle and build inputs should remain reviewed as one release. Production version `b8c6df95-122e-46b1-993f-a0ab5e7270e7` deployed successfully.

## Validation and limits

Local checks cover cryptographically signed Access tokens, wrong identities/audiences/signatures/expiry, Basic-bypass rejection, named roles, import backoff and pagination, manual reconciliation, encrypted round trips, tampering, foreign-key failures, file overwrite prevention and migration rollback. Browser checks cover the daily workspace/core workflows and mailbox recovery UI, including mobile confirmation. Provider tests use synthetic responses.

Final verification:

- **236 full unit tests passed**, no failures or skips; the focused CRM suite now contains **75 tests**, including seven-day no-reply reminder creation, deduplication and automatic clearing after a reply.
- **22 CRM browser tests passed** in the isolated synthetic preview, including the website cost calculator’s structured CRM payload, global search, duplicate-account confirmation, enquiry archive/restore, relationship and pipeline filtering, pipeline stage settings, customer CSV import preview/commit, customer/service/lead-source filtering, Today bounded task due-date/type/undated filters, persistent saved views across reload, audited bulk task completion and intentional undated task creation. The separate calculator regression suite passed **26 tests** against Astro dev. The mobile mailbox screenshot was inspected and its panel spacing/hidden skip-link corrected before the final run.
- **721 static pages built** successfully in the final local build. Windows denied dependency reads in the initial sandbox attempt; the permitted outside-sandbox build passed with `CRM_LOCAL_BUILD=1`, which skips Sentry uploads.
- **Worker dry run passed** with Wrangler 4.78.0: 1591.23 KiB uncompressed / 254.63 KiB gzip. This is a bundle check, not a Cloudflare runtime or live deployment test.
- **Migration/rollback rehearsals passed** for synthetic legacy data, a SQL export already on 0016 and a SQL export already on 0017. The 0018 task-date and 0019 saved-view migrations pass in the synthetic upgrade, preserve all existing task data and roll back cleanly. Already-applied migrations were not repeated.
- The encrypted backup test restores a synthetic schema plus enquiry/message contents and checks table counts. The pre-launch production export was obtained and passed the migration rehearsal; an independent restore drill remains outstanding.

Preview: `http://127.0.0.1:4350/admin/crm/?view=health`. It uses synthetic data and cannot send mail. `npm run crm:dev` starts it after a build; restarting resets the demo data.

Still outstanding: activated MFA, scheduled backups/off-site storage, a real restore drill, real mail delivery tests, general webhooks/calendar and exhaustive scale/accessibility certification.
