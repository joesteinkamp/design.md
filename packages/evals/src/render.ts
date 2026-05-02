// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

/**
 * Headless rendering via Playwright. Loaded lazily so the default eval run
 * does not require Playwright to be installed.
 */

let browserPromise: Promise<unknown> | undefined;

export interface RenderOptions {
  width?: number;
  height?: number;
}

export async function renderToPng(html: string, opts: RenderOptions = {}): Promise<Buffer> {
  const { chromium } = await import('playwright');
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  const browser = (await browserPromise) as Awaited<ReturnType<typeof chromium.launch>>;
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 },
  });
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await context.close();
  }
}

export async function shutdownRenderer(): Promise<void> {
  if (!browserPromise) return;
  const browser = (await browserPromise) as { close: () => Promise<void> };
  await browser.close();
  browserPromise = undefined;
}
