import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: 'https://11aee4f35c9f9dc5a3fa800eb6e2a4e1@o4511469821427712.ingest.de.sentry.io/4511472221225040',
  sendDefaultPii: true,
  enableLogs: true,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  ignoreErrors: [
    't.$_Tawk.i18next is not a function',
    // iOS in-app browsers (Instagram/Facebook/TikTok) inject a native-bridge
    // script into the page itself (frames show our URL, so denyUrls can't
    // catch it). Its sendDataToNative/sendPageHideMessage throw on pagehide
    // when the WKWebView bridge is already gone. We never use window.webkit.
    /window\.webkit\.messageHandlers/,
  ],
  denyUrls: [
    /embed\.tawk\.to/i,
    /\/_s\/v4\/app\/.*\/js\/twk-(?:chunk|vendor)/i,
    // Cloudflare Zaraz (edge-injected third-party tag manager). Its beacon
    // POSTs to /cdn-cgi/zaraz/t fail as "TypeError: Load failed" on flaky
    // connections and surface as unhandled rejections from /cdn-cgi/zaraz/s.js.
    /\/cdn-cgi\/zaraz\//i,
  ],
  beforeSend(event) {
    // Drop a third-party noise error seen on Mobile Safari: an unhandled
    // promise rejection surfacing WebKit's generic SyntaxError DOMException
    // ("The string did not match the expected pattern.", code 12). It comes
    // from third-party scripts (Tawk.to / Zaraz-managed tags), not our code,
    // and arrives with no attributable stack frame, so denyUrls can't catch it.
    // We only drop it when no stack frame points at our own origin, so a
    // genuine same-message error from our code would still be reported.
    const ex = event.exception?.values?.[0];
    if (
      ex &&
      ex.value === 'The string did not match the expected pattern.' &&
      ex.mechanism?.handled === false
    ) {
      const frames = ex.stacktrace?.frames ?? [];
      const fromOurCode = frames.some((f) =>
        (f.filename ?? '').includes('nc-digital.co.uk')
      );
      if (!fromOurCode) return null;
    }
    return event;
  },
});
