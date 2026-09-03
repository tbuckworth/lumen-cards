import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173/lumen-cards/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 15'], browserName: 'webkit' }
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' }
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' }
    }
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/lumen-cards/',
    reuseExistingServer: true
  }
})
