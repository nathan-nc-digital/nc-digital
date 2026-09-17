# Enquiries CRM and Zoho Mail

The CRM is deployed at `/admin/crm/` and the production database migration has been applied. Zoho, notification and admin settings are stored as Cloudflare secrets. Capture remains disabled pending the live email test. Screenshots in `output/crm/` use synthetic test data.

## What is included

- Contact/offer forms using `EnquiryForm.astro` and the free website plan can create durable tickets.
- Search, status and assignment filters, follow-up dates, priorities, internal notes and ticket activity.
- Replies sent from `nathan@nc-digital.co.uk` through Zoho Mail, with a durable outbox and explicit delivery status.
- Customer email replies matched back to an existing ticket using a random reference in the subject plus the customer's email address.
- A manual sync button and background syncing through the existing scheduled Worker.
- Create a linked job on the existing jobs board without duplicating the job on repeated clicks.
- CRM access is currently Nathan-only, consistent with the existing admin permissions. Assignment to Ben is supported, but does not grant him access to the mailbox. Linked jobs follow the existing jobs-board access rules.

The current Web3Forms route remains active until `CRM_ENABLED` is set to the exact string `true`. Public forms check `/api/enquiries/config`; if capture is enabled, they submit only to `/api/enquiries`. They never fall back to Web3Forms after an uncertain CRM submission, which prevents duplicate or untracked enquiries.

## Required configuration

Confirm the Zoho account region first; do not infer it from the business location.

| Setting | Purpose |
| --- | --- |
| `CRM_ENABLED` | Non-secret activation flag; leave unset or `false` until setup is complete. |
| `ZOHO_REGION` | `eu` for `mail.zoho.eu`, or `com` for `mail.zoho.com`. Other data centres need an explicit hostname mapping. |
| `ZOHO_ACCOUNT_ID` | Numeric mailbox account ID from Zoho's account API. |
| `ZOHO_CLIENT_ID` | OAuth application's client ID. |
| `ZOHO_CLIENT_SECRET` | OAuth client secret; store as a Cloudflare secret. |
| `ZOHO_REFRESH_TOKEN` | Offline OAuth refresh token; store as a Cloudflare secret. |
| `WEB3FORMS_ACCESS_KEY` | Existing browser-form fallback key; store as a Cloudflare secret if the legacy route is needed. CRM notifications use Zoho because Web3Forms rejects server-side submissions on the current plan. |
| `ADMIN_PASSWORD` | Nathan's admin password, stored as a Cloudflare secret. Missing secrets deny access. |
| `BEN_PASSWORD` | Ben's jobs-board password, stored as a Cloudflare secret; does not grant CRM access. |

Do not paste passwords, client secrets or refresh tokens into chat or commit them to the repository. Use Cloudflare's Worker secret settings or a secure local secret-entry workflow. This integration uses OAuth, not the Zoho mailbox password. Access tokens are reused until shortly before expiry and never returned by the setup endpoint. The shared D1 cache stores only AES-GCM ciphertext, using a key derived from the connection's high-entropy OAuth credentials. Credential changes invalidate the cache. A database lock prevents concurrent refreshes. This avoids Zoho's limit of ten access-token requests per ten minutes.

## Zoho authorisation

Region confirmed by Nathan: `https://mailadmin.zoho.eu/` (EU).

### Windows connection helper

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\connect-crm-zoho.ps1` from the project folder in a local terminal. It prompts for the client ID, secret and freshly generated code without displaying the inputs. It exchanges the code with Zoho EU, checks that the account is Nathan's native Zoho mailbox, and saves one uniquely named `.tmp/crm-zoho-credentials-*.xml` file, excluded from Git. All connection values are inside a Windows DPAPI-protected credential, decryptable by the same Windows user on the same computer; this does not protect against processes already running as that user. Do not print/import the decrypted values into tool output or chat. Only pass them directly to the eventual Cloudflare secret upload process.

The helper does not send email, deploy, change Cloudflare or activate CRM. It does not save the short-lived access token or grant code. A failed attempt may still have issued a Zoho grant; remove unused grants from Zoho when setup is complete. Keep the encrypted file until Cloudflare setup is verified, then remove that specific file with Nathan's approval. `-SelfTest` checks the helper using synthetic credentials and no network requests.

If setup fails, share only the `Failed step` and `Diagnostic` lines. The helper identifies input, authorisation, mailbox verification, encryption and saving failures. Provider errors are mapped to fixed explanations using an exact allowlist; raw response bodies and exception messages are never printed. Generate a fresh code for each retry using the same EU Self Client. Unknown failures remain redacted.

Before requesting any credentials, the helper now saves and restores a synthetic credential using the same storage function, checks that its secret values are encrypted on disk, and removes that uniquely named test file. Run with `-StorageTest` to perform only this check without prompts or network requests. Local failures report the precise storage operation, exception type and script line without printing secret-bearing messages. `-SelfTest` also exercises the actual file save/restore path.

SecureString construction uses .NET directly because separately launched PowerShell sessions in this environment could not resolve `ConvertTo-SecureString`. Windows DPAPI encryption and the saved credential format are unchanged. The self-test passed both directly and through `Start-Process`, which reproduced the original missing-command failure before this fix.

1. In the API Console for the mailbox's data centre (`https://api-console.zoho.eu/` or `https://api-console.zoho.com/`), register a self-client for this private single-mailbox integration. Follow Zoho's current OAuth setup instructions.
2. Authorise the `nathan@nc-digital.co.uk` mailbox with the least required scopes: `ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE`. Account READ is needed to discover and verify the mailbox's account ID. No mailbox delete/update scope is needed.
3. Exchange the authorisation code on that same data centre's `/oauth/v2/token` endpoint and store the refresh token and client credentials securely.
4. Call Zoho's Get All User Accounts endpoint with the resulting access token; select and verify the account belonging to `nathan@nc-digital.co.uk`. Configure its account ID.
5. Set the non-secret region and account ID, and the required secrets, on the existing Worker. Verify the authorised mailbox and API access with a read-only sync before any real send.

Account plan restrictions, organisation policy and actual API access cannot be verified until the mailbox is authorised. The UI distinguishes configuration from a completed sync.

## Activation order

1. Review the local implementation and confirm the mailbox authorisation.
2. Admin authentication now reads `ADMIN_PASSWORD` and `BEN_PASSWORD` from Cloudflare secrets and uses Web Crypto for password comparison. Source-defined passwords were removed during CRM rollout; the existing password values were preserved so current logins continue to work. Basic authentication remains the sign-in method. Ensure both secrets exist before deploying; authentication fails closed if they are missing.
3. Apply `migrations/0015_crm.sql` to the existing `nc-digital-jobs` D1 database using the project's existing manual D1 execute workflow. This adds new CRM tables and indexes; it does not modify existing jobs data.
4. Deploy the Worker and freshly built site together, initially leaving `CRM_ENABLED=false`. Deploying only static assets against an old Worker would omit `/api/enquiries/config`.
5. Check `/admin/crm/` reports a ready database, configured Zoho and configured Web3Forms notifications. Run a read-only sync to validate authorisation.
6. Enable `CRM_ENABLED=true`, then make one explicitly approved end-to-end test using an address you control: submit the form, verify one ticket and notification, send a reply, reply to that email and sync the response back into the ticket.
7. Confirm delivery states and the original Web3Forms notification destination. Existing form code remains able to use Web3Forms if capture is switched off again.

Only the activation flag needs to change to return new form submissions to the original route. Existing CRM data remains stored. Switching the flag off also pauses the background CRM scheduler.

## Delivery behaviour and limitations

- Ticket and first message are saved atomically with the queued notification before the form displays success.
- CRM notifications and customer replies are sent through Zoho from `nathan@nc-digital.co.uk`. Messages use escaped content, then `Kind regards,` / `Nathan` and the hosted NC Digital signature image; the legacy browser form can still use Web3Forms when CRM capture is disabled. A missing Zoho connection leaves notifications visibly queued.
- The existing minute-based schedule processes up to three queued deliveries and one page of matching email search results per run. Provider latency, quotas and search indexing can delay delivery or sync; this is not instant push delivery.
- Successful send means Zoho accepted the email, not that the recipient received or read it. Bounce tracking is not included.
- Explicit validation/authentication/rate-limit rejections are marked failed and may be manually retried. Transport errors and server errors are marked unconfirmed. They are not automatically retried because the provider may already have accepted the email. Check the original mailbox before manually sending another copy.
- Tickets move to Waiting after an accepted reply, unless a newer customer message or a closed/spam state should be preserved. Spam classification cancels pending queued replies.
- Only replies carrying `[NC-<16 hexadecimal characters>]` and coming from the original contact's address are imported. Changed subjects, other senders, replies from a different address and unrelated mailbox messages are not imported. Historical Web3Forms emails are not backfilled.
- Incoming content is converted to plain text. Attachments are flagged but remain in Zoho. Outgoing attachments, rich text, shared-mailbox access for Ben and full mailbox synchronisation are not part of this version.
- Search pagination is persisted through backlogs and message IDs deduplicate repeats. A backlog can take multiple scheduled runs to finish. The most recent 500 timeline entries are displayed.
- Per-source submission limits, bounded request bodies, same-origin checks, a honeypot, prepared SQL and safe text rendering are included. Browser validation is not the security boundary.
- Unsaved reply/note drafts remain in page memory when changing tickets, modes or refreshing the inbox. Leaving/reloading the page warns about unsaved drafts; drafts are not written to browser storage.

## Validation

During the live rollout, the Workers runtime rejected `redirect: 'error'` before making a request. CRM provider calls now use `redirect: 'manual'` and explicitly reject 3xx responses without forwarding credentials. This was reproduced with the actual Workers runtime using dummy credentials. Token reuse and encrypted D1 storage were also verified in that runtime, alongside unit tests for expiry, credential rotation, tampering and refresh concurrency.

- `node --test tests/unit/crm.test.js`
- `node --test tests/unit/worker.test.js`
- `npm.cmd run build`
- `npx.cmd playwright test --config tests/crm-playwright.config.ts`

The provider and inbox used by the automated tests are mocked; they do not contact Zoho or send mail. The unit tests run real SQLite queries through a D1-shaped adapter. A final Cloudflare/Zoho end-to-end test is required after authorisation and activation.

## Official references

- [Zoho Mail OAuth](https://www.zoho.com/mail/help/api/using-oauth-2.html)
- [Zoho OAuth token limits](https://www.zoho.com/developer/oauth/token-limits.html)
- [Send email](https://www.zoho.com/mail/help/api/post-send-an-email.html)
- [Reply to email](https://www.zoho.com/mail/help/api/post-reply-to-an-email.html)
- [Search email](https://www.zoho.com/mail/help/api/get-search-emails.html)
- [Search syntax](https://www.zoho.com/mail/help/search-syntax.html)
- [Read email content](https://www.zoho.com/mail/help/api/get-email-content.html)
- [Cloudflare D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
