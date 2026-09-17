# Website audit and sales report

Admin URL: `/admin/website-audit/`, Nathan-only API under `/admin/website-audit/api/`. Apply migration `0008_website_audits.sql`. No additional API key or DataForSEO spend is required.

Users enter a public website and optional business name. The default sample is ten pages, with a five-page quick option, followed by up to twenty further same-site HTML link destinations. Crawl rules are checked first; exclusions are respected. Forms and query-string actions are not requested. One step runs at a time and saves progress in D1. Closing the page pauses the audit after the active step. Saved completed reports with successful HTML coverage are reused for seven days, unless a fresh audit is requested. Ten new audits per hour maximum; a global expiring lock prevents overlapping starts and steps.

The crawler requests public HTML without user cookies or credentials, checks public DNS before each redirect, rejects IP literals, local/reserved domains, query strings and custom ports, and only follows redirects within the same hostname (including www aliases). Responses have byte limits and a shared per-fetch deadline. Page analysis uses parse5, not a regular-expression HTML parser. No downloaded scripts execute.

Checks: title and meta description presence/duplicates, source H1, mobile viewport/zoom restrictions, image alt attributes, document language, HTTP transport, insecure asset references, noindex directives, cross-host canonical hints, basic enquiry routes and social preview metadata. Only confirmed GET 404/410 responses are classified as missing destinations. Other failures are coverage gaps. Source-only findings requiring rendered-page context are labelled Review.

The report explicitly excludes rendered mobile layout, form delivery, Core Web Vitals, rankings, traffic forecasts and full accessibility compliance. A manual checklist and PageSpeed Insights link support follow-up. It does not invent a health score or revenue-loss figure.

Client name, introduction and recommended next steps are editable and saved. Reports can be printed/saved as PDF through the browser or downloaded as standalone HTML with embedded styles and escaped text. Notes are saved before export. Reports remain behind admin authentication; downloaded documents can be shared manually.

Validation: unit tests cover parsing, SSRF filtering, redirects, robots policy, crawl limits, caching, notes and concurrency. Playwright covers the report flow, note persistence, HTML injection escaping, export, print layout and mobile overflow. Run `npm run test:unit`, `npm run build`, and `npx playwright test --config tests/audit-playwright.config.ts`.
