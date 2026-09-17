# NC Digital client workspace

Implementation date: 16 September 2026. This is the core CRM and sales workspace. Production release deployed 16 September 2026 as Worker version `b8c6df95-122e-46b1-993f-a0ab5e7270e7`; D1 migrations 0016–0019 are applied. The live workspace currently contains one account, Chris Wulder, with one linked contact and enquiry.

## Open the local preview

After a local build, run `npm run crm:dev` and open http://127.0.0.1:4350/admin/crm/.

The preview uses synthetic customers in an in-memory SQLite database, with foreign keys enabled and the actual CRM API modules. It listens only on loopback. Restarting it discards preview records. It has no Zoho credentials and cannot deliver email. Do not enter real client information into this disposable preview.

For a local build in PowerShell, set `$env:CRM_LOCAL_BUILD='1'` before `npm run build`. That flag omits the Sentry build integration so the local build does not upload source maps. It does not alter the normal production build configuration.

## Implemented

| Area | Behaviour |
|---|---|
| Today | Due/overdue actions, upcoming tasks, open tasks missing a due date, new/open conversations, opportunities missing a next action, stale opportunities, quote decisions, renewals and mailbox health. Pipeline and recurring contract values are separated; open pipeline now shows stage totals and a probability-weighted value, with visible stage filters when opened. The attention card opens tasks with a visible due-date filter. |
| Customers and contacts | Distinct business/customer and person records; contact details, website, relationship status, reusable tags and notes. Filter the customer, contact and opportunity lists by tag, and search tags with the normal list search. Exact email, phone and website matches warn before a second customer is saved, and matching contact email or phone warns within the same customer; explicit overrides cover legitimate shared details. Customer CSV import validates rows, previews duplicates and invalid data, skips unsafe rows and uses an idempotent audited commit. Explicitly link an existing enquiry to an existing or newly created account. Linking carries its tasks into the account. |
| Customer overview | Related people, opportunities, tasks, quotes, services and one chronological activity timeline combining notes, calls, meetings, messages and CRM changes. |
| Manual enquiries | Phone-only, email and offline leads. At least one contact method and a first follow-up date are required. Phone-only enquiries can be given a validated reply address from the inbox before sending. |
| Pipeline | Board and list, eight initial stages, version-checked stage changes, one-off GBP value, expected close date, lost reason, future opportunities, tags and next actions. Winning converts the linked account to a customer. Stage, customer, service, tag, lead-source and close-by filters plus latest-update, highest-value and expected-close sorting keep the list focused; the active view remains visible and can be cleared. Pipeline stage names, order and probabilities can be edited from the audited settings dialog; stage outcomes remain fixed. |
| Tasks | Due dates, quick date choices, bounded due-date and undated filters, task-type filtering, priority, completion/reopening and customer/opportunity/enquiry links. Open tasks on the current page can be selected and completed together with version checks and audit entries. Automatic enquiry review, reply follow-up, quote follow-up, onboarding, renewal and seven-day no-reply reminder tasks. |
| Quotes | Integer-pence line items, quantity, VAT, separate one-off/monthly/quarterly/annual totals, terms, expiry and immutable revision snapshots. Print/Save PDF, queue through a linked enquiry, or explicitly record an external send. Record acceptance/rejection with evidence notes. Acceptance creates onboarding and updates the linked opportunity/account. |
| Services | Active/paused/cancelled contracts, monthly/quarterly/annual/one-off frequency, price, start/renewal/end dates and cancellation reason. Renewal advances the date and completes its reminder. MRR/ARR use active contracts and a single final rounding step. These figures are contracted revenue, not cash collected or accounting revenue. |
| Inbox reliability | Preserve incoming full text/source separately from the displayed excerpt; expand the full plain message. Require a valid provider receipt before marking a send accepted. First-reply enquiry context is included once when multiple replies are queued. Record send attempts; never automatically repeat an ambiguous send. Conversations open at the newest message first, while the full history remains available in reverse chronological order. Archive and restore enquiries from the inbox without losing their conversation. |
| Drafts | Private server-stored email/settings and main record-form drafts, restored after reload. Version conflicts prevent silently overwriting another tab's draft or saved record. |
| Recovery and access | Soft archive/restore for workspace records, audit entries, active-work archive guards and database relationship guards. Existing Nathan-only CRM access remains enforced. Jobs writes now check Origin, JSON type and request size. CRM pages set a restrictive CSP/frame policy. |
| Daily usability | Responsive layouts, keyboard-visible focus, labelled fields, native dialogs, global search shortcut, customer/contact/enquiry/message/note and opportunity service/source search, filters in URLs, persistent server-backed saved views, paginated lists, CSV exports with formula escaping, clickable contact details, UK date handling, source/value context on Today’s enquiry list and a date-filtered Reports view. Manual enquiries and inbox tickets record lead source, temperature and tags so phone, WhatsApp and referral work stays visible alongside website leads. |

Email signatures retain the existing “Kind regards, Nathan” image signature. Existing ticket IDs, references, messages and job links are preserved by the migration. Earlier data already lost by the old email parser cannot be recreated by this upgrade.

## Code and database map

- `src/pages/admin/crm.astro` and `src/components/CrmWorkspace.astro`: workspace shell.
- `src/pages/admin/crm/inbox.astro`: existing enquiry inbox, now linked from the workspace. Old `/admin/crm/?ticket=...` links redirect to the inbox.
- `src/scripts/crm-workspace.js`, `src/styles/crm-workspace.css`: workspace views, editors and interactions.
- `src/scripts/crm.js`: inbox, settings, drafts, expanded originals and customer linking.
- `src/lib/crm-workspace.js`: authenticated `/admin/crm/api/workspace/*` endpoints for records, lists, Today, account overview, linking, drafts, activity, search, exports, validated customer CSV imports and version-checked pipeline stage settings.
- `src/lib/crm-commercial.js`: quotes, services, renewals and scheduled reminder creation.
- `src/lib/crm-domain.js`, `src/lib/crm-dates.js`: validation, money, relationships, optimistic concurrency and UK time conversion.
- `src/lib/crm-api.js`, `src/lib/crm-zoho.js`: public enquiry intake, inbox and provider integration.
- `src/pages/website-cost-calculator.astro`: calculator capture, with quote breakdown and selections passed to the same CRM enquiry endpoint as the contact form.
- `migrations/0016_crm_workspace.sql`: additive schema after `0015_crm.sql` and the existing jobs schema.
- `migrations/0017_crm_reliability.sql`: import queue, delivery confirmation fields and reliability state.
- `migrations/0018_crm_undated_tasks.sql`: allows tasks without a due date while preserving task indexes and relationship guards.
- `migrations/0019_crm_saved_views.sql`: stores validated private list views per CRM owner.

New tables: `crm_accounts`, `crm_contacts`, `crm_stages`, `crm_opportunities`, `crm_tasks`, `crm_quotes`, `crm_quote_items`, `crm_quote_revisions`, `crm_services`, `crm_activities`, `crm_audit`, `crm_drafts`, `crm_message_attempts`, `crm_sync_items`, `crm_saved_views`. Existing ticket/message tables receive additional columns and indexes. Migration 0020 adds portable JSON tag columns and indexes to accounts, contacts, opportunities and enquiries. The schema flags are `crm_state.workspace_schema=1`, `crm_state.reliability_schema=1`, `crm_state.task_dates_schema=1`, `crm_state.saved_views_schema=1` and `crm_state.tags_schema=1`.

## Validation commands

Verified locally: 236 unit tests passed; the CRM browser suite covers 22 synthetic-preview tests, including calculator capture, global search, duplicate-account confirmation, enquiry archive/restore, relationship and pipeline filtering, pipeline stage settings, customer CSV import preview/commit, customer/service/lead-source filtering, bounded Today task due-date/type/undated filters, persistent saved views across reload, audited bulk task completion and intentional undated task creation; the separate website calculator suite covers 26 tests; the production-style static build generated 721 pages; the migration rehearsal passed. The deployed Worker, canonical site, protected CRM route, contact page and calculator page returned expected live responses after release. No live outbound email was sent by this release. The contact-form and calculator tests use reduced motion after animation/scroll-related timeouts were observed. Browser coverage verifies the stated workflows, not every later roadmap feature or a production deployment.

```text
npm run crm:check-migration
npm run crm:test
npm run test:unit
node node_modules/@playwright/test/cli.js test --config tests/crm-workspace-playwright.config.ts
```

The browser suite covers the real local account → opportunity → quote → recorded acceptance → service flow, manual phone-only intake, drafts across reloads, viewports at 320/390/1024/1440px, and the existing inbox/contact-form regression fixtures. Mail delivery assertions use mocked Zoho responses; no live test emails are sent.

`node scripts/crm-migration-check.mjs path/to/export.sql` rehearses pending 0016/0017/0018/0019 upgrades against a provided D1 SQL export **in memory**. It checks integrity, foreign keys, original table row counts/content, and rollback. Without an export it uses synthetic legacy records, including a BST midnight follow-up. Already-upgraded exports are verified without reapplying migrations; incomplete schema flags are rejected. A synthetic rehearsal is not a production backup/restore drill.

## Release sequence

1. Review this build and the remaining operational items below. Record the exact source/build being released; this workspace contains substantial pre-existing uncommitted work.
2. Obtain a fresh recoverable export of the entire shared `nc-digital-jobs` database, plus the current release/configuration references. Store the export privately; it contains customer data and may contain encrypted integration caches. Verify the actual export in the rehearsal tool and restore a copy to an isolated environment.
3. Briefly pause public intake, CRM writes and scheduled processing for the production upgrade. Recheck the backup and schema. Apply missing **0016, 0017, 0018 and 0019 once, in order**, preserving the existing 0015 tables. Do not run all unrelated historical migrations indiscriminately.
4. Deploy the matching Worker and static assets together. **The current capture/inbox/workspace release requires 0016 through 0019**; deploying it before migration can break intake, task views or saved-view controls. Keep the previous release available for rollback.
5. Verify authenticated/anonymous/Ben access, public capture, database integrity and existing record counts. Check the new workspace and original inbox. Test sending and receiving only with an explicitly authorised test recipient. Confirm actual Worker/D1/CSP behaviour in the deployed environment.
6. Resume scheduled work and check queue receipts, sync status and renewal reminders. Verify the live site still emails the initial enquiry notification.

The safe rollback is to the previous application while retaining the additive tables. Do not drop the new tables once they contain work. A full database restore can lose writes after the backup and affect the other tools sharing D1; it requires a deliberate recovery decision.

## Remaining operational work before treating this as production-ready

- Managed Access token validation, expiry/revocation and named roles are now implemented locally. Live Access/MFA policies have **not** been activated. Existing Basic authentication remains the default until configured; no credentials were rotated. See [production preparation](crm-production-readiness.md).
- The local dependency refresh reports zero npm audit findings and uses Astro 7.3.2. The reviewed Worker/assets release is deployed; the lockfile and static bundle should remain paired for future releases.
- A pre-launch production export is retained privately in the local `.tmp` folder. Independent scheduled off-site backups, a live restore drill and a real outbound email test still need to be completed.
- Durable import retries, a mailbox health screen, explicit ambiguous-send reconciliation and seven-day no-reply follow-up tasks are implemented. Their live configuration and behaviour still need verification. A send accepted by Zoho is not proof of inbox delivery. Attachments remain in Zoho.
- Local tests use SQLite/D1 wrappers and a loopback preview; deployed Cloudflare runtime checks, real email-client rendering and full accessibility/security certification remain separate checks.

## Deliberately bounded first release

This implements the core customer/sales workflows; it does not implement every later item in the audit roadmap. In particular:

- One initial pipeline and Nathan CRM ownership. Stage names, order and probabilities are editable, while stage outcomes remain fixed until a safer full stage lifecycle is needed. Ben remains a jobs user.
- Search covers customer, contact and enquiry identity/details, message bodies, private notes, opportunity titles, task text and quote titles/numbers. It returns up to 50 matches; a dedicated full-text index and fuzzy relevance ranking are later scale improvements.
- Saved views are private to Nathan, persist in D1 and store only validated URL filters. Sharing, permissions and view deletion are intentionally deferred until multi-user needs justify them.
- Lists are paginated at 50 records. Board counts describe the displayed page. Dropdowns load up to 500 records; account histories and Today lists have explicit limits. Larger datasets need searchable selectors, aggregate counts, more history pagination and measured load tests.
- Duplicate account suggestions are available when linking an enquiry, and exact account identifiers are checked before saving. Customer CSV import is intentionally limited to validated account rows; there is no destructive merge or automatic fuzzy customer identity matching.
- The customer activity timeline covers workspace records and linked conversations; there is not yet audit coverage for every old jobs action. The original jobs board's deletion behaviour is unchanged.
- Quote PDF uses browser Print/Save PDF. There are no automated PDF attachments, customer acceptance portal, discounts, invoicing or payment collection. Acceptance is a deliberate internal record backed by a note.
- A service can be added from an accepted quote; its contract details are entered and checked explicitly. There is no automatic billing integration or historical cash/lifetime-value report.
- Website/Zoho remain the existing integrations. Contact and cost-calculator enquiries are captured in the CRM; calculator leads also store source, website tier, build total, hosting choice and itemised estimate metadata. The workspace now includes portable tags, a focused Reports view and explicit manual lead channels. Calendar sync, general webhooks, private document storage, custom-field builders and AI remain later work.
- Phone-only leads initially use telephone follow-up; the inbox can add or change a validated reply email before a response is sent.

These limits should remain visible in planning. They do not imply that the remaining roadmap or the original security audit has been fully resolved.
