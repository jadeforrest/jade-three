import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:4321',
    browserName: 'chromium',
  },
  globalSetup: './tests/global-setup.ts',
});
