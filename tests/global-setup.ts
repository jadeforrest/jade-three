import { preview } from 'astro';

// Astro 7's `astro preview` CLI daemonizes itself, so Playwright's `webServer`
// sees the foreground process exit immediately. Drive the preview server
// programmatically instead and stop it when the run finishes.
export default async function globalSetup() {
  const server = await preview({
    logLevel: 'error',
    server: { port: 4321 },
  });

  return async () => {
    await server.stop();
  };
}
