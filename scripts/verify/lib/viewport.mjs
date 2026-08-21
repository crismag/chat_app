/*
 * A screenshot you are allowed to believe.
 *
 * Every mobile number gathered before this existed was taken at 576px while
 * printing 390, because Chrome clamps its window width and a CDP metrics
 * override silently reverts between Selenium commands. A harness that measures
 * the wrong thing is worse than no harness: its numbers get quoted.
 *
 * So nothing here reports a capture without first proving the browser is
 * actually at the requested size, from six independent directions — the layout
 * viewport, the document, the visual viewport, the pixel ratio, and the real
 * pixel dimensions of the PNG that came back. If any of them disagrees, the
 * capture throws instead of being written.
 */
import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync, mkdirSync } from 'node:fs';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Emulation given at launch, which the browser owns and cannot quietly drop.
 *
 * `Emulation.setDeviceMetricsOverride` sent afterwards belongs to a CDP session
 * that Selenium recreates per command, so it lasts exactly one instruction.
 */
export function newDriver({ width, height, dpr = 2, safari = false }) {
  const options = new chrome.Options()
    .addArguments('--headless=new', '--no-sandbox', '--hide-scrollbars')
    .setMobileEmulation({
      deviceMetrics: { width, height, pixelRatio: dpr, touch: true },
      /*
       * Mobile Safari is emulated by its user agent only. That is honest about
       * what it is: it exercises UA-conditional code paths, not WebKit. It is
       * not a substitute for a real device, and nothing here claims otherwise.
       */
      ...(safari
        ? {
            userAgent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
              '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          }
        : {}),
    });
  return new Builder().forBrowser('chrome').setChromeOptions(options).build();
}

/**
 * Dark theme, which is a media feature rather than a Chrome mode.
 *
 * `--force-dark-mode` does not touch `prefers-color-scheme` — it turns on
 * Chrome's own auto-darkening, which repaints a light page and leaves the
 * query answering "light". The assertion in `capture` caught that, which is
 * the only reason these are not light screenshots labelled dark.
 *
 * `setEmulatedMedia` does set the query, and unlike the device-metrics
 * override it survives subsequent commands and router navigations — verified,
 * not assumed.
 */
export async function emulateDark(driver) {
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
}

/** Ask the page what it is, from every angle that can disagree. */
export async function measure(driver) {
  return JSON.parse(
    await driver.executeScript(`return JSON.stringify({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      visualWidth: window.visualViewport ? Math.round(window.visualViewport.width) : null,
      dpr: window.devicePixelRatio,
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    })`),
  );
}

/**
 * Capture, having proved the viewport first.
 *
 * `scrollWidth` is checked against the viewport rather than merely recorded:
 * a page wider than its own viewport is the exact defect these captures exist
 * to find, and a screenshot that quietly crops it would hide it. Overflow does
 * not throw — it is reported and returned, because seeing the broken layout is
 * the point — but it can never pass unnoticed.
 */
export async function capture(driver, { width, height, dpr = 2, dark = false, out, name }) {
  const seen = await measure(driver);

  const wrong = [];
  if (seen.innerWidth !== width) wrong.push(`innerWidth ${seen.innerWidth} ≠ ${width}`);
  if (seen.clientWidth !== width) wrong.push(`clientWidth ${seen.clientWidth} ≠ ${width}`);
  if (seen.visualWidth !== null && Math.abs(seen.visualWidth - width) > 1) {
    wrong.push(`visualViewport ${seen.visualWidth} ≠ ${width}`);
  }
  if (seen.dpr !== dpr) wrong.push(`devicePixelRatio ${seen.dpr} ≠ ${dpr}`);
  if (dark && !seen.dark) wrong.push('dark theme requested but prefers-color-scheme is light');
  if (wrong.length) {
    throw new Error(`Viewport not as requested for "${name}":\n    ${wrong.join('\n    ')}`);
  }

  const b64 = await driver.takeScreenshot();
  const png = Buffer.from(b64, 'base64');
  /* PNG IHDR: width and height are big-endian 32-bit at byte 16 and 20. */
  const pixels = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
  if (pixels.w !== width * dpr) {
    throw new Error(
      `Screenshot is ${pixels.w}px wide; ${width}×${dpr} should be ${width * dpr}px ("${name}")`,
    );
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(new URL(`${name}.png`, `file://${out}/`), png);

  const overflow = seen.scrollWidth - seen.clientWidth;
  return { ...seen, pixels, overflow };
}

/** One line per capture, so a run reads as evidence rather than as noise. */
export function report(name, m) {
  const flag = m.overflow > 0 ? `  ⚠ OVERFLOW +${m.overflow}px` : '';
  console.log(
    `  ${name.padEnd(42)} ${m.innerWidth}×? css · client ${m.clientWidth} · ` +
      `scroll ${m.scrollWidth} · vv ${m.visualWidth} · dpr ${m.dpr} · ` +
      `${m.pixels.w}×${m.pixels.h}px · ${m.dark ? 'dark' : 'light'}${flag}`,
  );
}
