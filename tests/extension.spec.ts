/**
 * Extension integration tests.
 * Tests the extension with Playwright to verify functionality.
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..', 'dist');

/**
 * Helper to launch browser with extension loaded.
 */
async function launchWithExtension(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });

  // Wait for extension to initialize
  await new Promise(resolve => setTimeout(resolve, 1000));

  return context;
}

/**
 * Get the extension ID from the loaded extension.
 */
async function getExtensionId(context: BrowserContext): Promise<string> {
  // Open extensions page
  const page = await context.newPage();
  await page.goto('chrome://extensions');

  // Get extension ID (this is a simplified approach)
  // In real tests, you'd parse the extensions page
  await page.close();

  // For now, we'll get it from service worker
  const workers = context.serviceWorkers();
  for (const worker of workers) {
    const url = worker.url();
    if (url.includes('chrome-extension://')) {
      const match = url.match(/chrome-extension:\/\/([^/]+)/);
      if (match) {
        return match[1];
      }
    }
  }

  throw new Error('Extension ID not found');
}

test.describe('Extension Loading', () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await launchWithExtension();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('extension loads successfully', async () => {
    // Check that service worker is running
    const workers = context.serviceWorkers();
    expect(workers.length).toBeGreaterThan(0);

    // Check for our extension's service worker
    const extensionWorker = workers.find(w =>
      w.url().includes('chrome-extension://')
    );
    expect(extensionWorker).toBeDefined();
  });

  test('popup opens', async () => {
    const extensionId = await getExtensionId(context);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    // Check popup elements exist
    await expect(popupPage.locator('h1')).toContainText('Agent Jake');
    await expect(popupPage.locator('#statusText')).toBeVisible();

    await popupPage.close();
  });
});

test.describe('Content Script', () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await launchWithExtension();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('content script injects on page load', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');

    // Check that content script logged its presence
    const logs: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('[AgentJake]')) {
        logs.push(msg.text());
      }
    });

    // Give content script time to load
    await page.waitForTimeout(1000);

    // Reload to capture the log
    await page.reload();
    await page.waitForTimeout(500);

    expect(logs.some(log => log.includes('Content script loaded'))).toBe(true);

    await page.close();
  });
});

test.describe('ARIA Snapshot', () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await launchWithExtension();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('generates snapshot for simple page', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('networkidle');

    // Trigger snapshot generation via evaluate
    // Note: In real usage, this would come through the WebSocket
    const snapshot = await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'generateSnapshot' },
          response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          }
        );
      });
    });

    // Basic validation - should have some content
    expect(snapshot).toBeDefined();

    await page.close();
  });
});
