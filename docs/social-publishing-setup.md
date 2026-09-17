# NC Digital social publishing

The protected composer is `/admin/social/`. Nathan's existing admin sign-in is required. Upload up to four images, write a caption and destination URL, adjust individual captions, and publish now or schedule. Saving a draft or connecting accounts never publishes.

## Free provider split

| Accounts | Connection | Scheduling |
| --- | --- | --- |
| X, LinkedIn, Google Business Profile | Buffer Free | Buffer queue |
| Facebook Page, linked professional Instagram account | Meta Graph API | NC Digital's Cloudflare Worker |

Buffer Free supports three connected channels and ten queued posts per channel. Connect just X, LinkedIn and GBP to this Buffer organisation. The server holds `BUFFER_API_KEY`; it never goes to the browser. An optional `BUFFER_ORGANIZATION_ID` selects an organisation if the API key has more than one.

This avoids a paid social scheduling subscription. The existing Cloudflare account's Workers, D1 and R2 usage allowances still apply. Meta access is subject to app permissions and account eligibility.

## Facebook and Instagram connection

1. Ensure the NC Digital Facebook Page is linked to NC Digital's Instagram **professional** account (Business or Creator) and the authorising Facebook user can create Page content.
2. Create/configure an app in Meta for Developers for Page publishing and Instagram API with Facebook Login. The authorising user must have an appropriate app role for development access. Follow the app dashboard's access level, review and live-mode requirements for public use; a token alone does not prove posts are publicly visible.
3. Request `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` and `instagram_content_publish`. A business-managed asset configuration can require additional access identified by Meta.
4. Obtain a long-lived user access token using Meta's supported token exchange, then request `GET /me/accounts?fields=id,name,access_token,tasks` to obtain the NC Digital **Page** access token. Check that the returned Page is correct and includes permission to create content. Do not use a temporary Graph API Explorer user token as the server's Page token.
5. Store that Page token as the Cloudflare Worker secret `META_PAGE_ACCESS_TOKEN` for `nc-digital`. Optionally pin `META_PAGE_ID` to NC Digital's numeric Page ID. Keep tokens out of source code, browser code, URLs, and git. The implementation defaults to Graph API `v26.0`; `META_GRAPH_VERSION` can override it for a reviewed migration.
6. Reload `/admin/social/`. Account discovery reads the Page and linked Instagram account. It does not publish. Check the names before selecting destinations.
7. Publish an actual approved launch post when ready and verify visibility from an account outside the app's roles. Reauthorise if Meta revokes access or the token expires.

## Deployment

`wrangler.toml` defines `JOBS_DB`, the `SOCIAL_MEDIA` R2 bucket (`nc-digital-social-media`), static assets and a once-per-minute cron trigger.

Apply `migrations/0004_social_posts.sql` and then `0005_direct_meta_publishing.sql` to the jobs D1 database. Migration 0005 contains ALTER TABLE statements and must only be applied once. Create the R2 bucket before binding it. Preserve existing Worker secrets when deploying. Build the Astro assets, bundle the Worker, deploy, and verify both bindings and cron.

For an authenticated Wrangler session, the standard commands are:

```powershell
npm.cmd run build
wrangler.cmd d1 migrations apply nc-digital-jobs --remote
wrangler.cmd deploy
```

If migrations were applied directly through the Cloudflare API, reconcile the migration ledger before using the D1 migration command. Domain routes are Cloudflare-managed; preserve them when deploying.

## Publishing behaviour

- Buffer holding queue: for an existing future post, choose **Queue for automatic Buffer scheduling**. Those destinations are marked **Queued in NC Digital**. The once-per-minute Worker uses two shared API reads to check up to 100 waiting deliveries and transfers at most three per run. Full channels wait until their next scheduled post frees space, plus five minutes; paused channels retry after two hours. Apply migrations `0012_social_buffer_queue.sql` and `0013_social_buffer_rate_limit.sql` before deploying this feature. Existing Buffer schedules continue to run in Buffer.
- Buffer API rate limits are separate from queue capacity. HTTP 429 persists the provider's `Retry-After` time in D1, pauses all Buffer API calls until then, and keeps explicitly queued deliveries retryable. An exhausted allowance does not cancel posts already scheduled in Buffer. See [Buffer API limits](https://developers.buffer.com/guides/api-limits.html).
- Deferred caption revisions use migration `0014_social_buffer_edits.sql`. The cron reads each existing Buffer post before editing, preserves its ID and scheduled time, checks for conflicting text or media changes, and reconciles interrupted confirmations on retry. The admin displays a pending-edit notice until confirmation. Only explicitly stored revisions are applied; posts already due are left unchanged.
- Only explicitly queued, unsubmitted destinations are transferred. Cancelling a post waiting for Buffer stops the handoff; manage already transferred posts in Buffer. Overlapping cron runs use a database lease and atomic delivery claims. An interrupted publish confirmation is never automatically resent. A schedule that passes before transfer is marked rejected for review rather than published late.

- Images become 1200 × 1200 JPEGs, fitted with white padding without cropping. Image URLs are public so providers can fetch them; the composer, API and credentials require admin authentication.
- Instagram requires an image and receives a single image or carousel. Caption links remain plain text. GBP receives the first image, caption and a Learn more button for the destination URL.
- Dates are shown in the browser's timezone and stored in UTC. Meta jobs normally start on the first cron tick after the selected time; provider processing and outages can delay publication. The browser can be closed. Buffer manages its own schedules.
- Each destination is claimed atomically before submission. A network interruption during publication leaves an uncertain status and will not be blindly retried. Review the relevant provider before creating another post.
- Instagram image containers are persisted and checked on later cron ticks. Definitively rejected destinations can be retried or copied into a new draft; accepted destinations are excluded.
- Cancel queued Facebook/Instagram stops unclaimed schedules or image preparation. An already publishing or published destination cannot be cancelled here. Manage Buffer queues in Buffer.
- Refresh status checks known Buffer post IDs and uncertain Instagram containers. It never creates a post. An uncertain Facebook publish needs a manual check in Meta Business Suite.

## Verification

`npm.cmd run test:unit` covers real SQLite migrations, validation, authentication, provider payloads, partial failures, concurrent claims, scheduling, cancellation, and ambiguous network failures. `npx.cmd playwright test --config tests/social-playwright.config.ts` checks the desktop/mobile composer with mocked provider calls. Live account authorisation and public posting must be verified separately once accounts are connected.

Sources: [Buffer plans](https://buffer.com/pricing), [Meta's Page token requests](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api), [Meta's Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
