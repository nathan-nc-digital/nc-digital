import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: 'https://11aee4f35c9f9dc5a3fa800eb6e2a4e1@o4511469821427712.ingest.de.sentry.io/4511472221225040',
  sendDefaultPii: true,
  enableLogs: true,
  tracesSampleRate: 0.1,
});
