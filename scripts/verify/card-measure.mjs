/*
 * How much of the reflection is actually on screen.
 *
 * The readiness review measured 345px visible of 1006px at 1280 — the card's
 * scroll region was a third of the card, so somebody writing their Testimony
 * could not see their Content. This measures the same thing so a change to it
 * can be seen to work rather than asserted.
 *
 *   node scripts/verify/card-measure.mjs
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const WEB = 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SECTIONS = {
  content: 'Romans 8:28 (NIV) — And we know that in all things God works for the good of those who love him, who have been called according to his purpose.',
  heart: 'I have read this verse for years and this is the first week it has cost me anything to believe it. Nothing about the last month looks like good.',
  application: 'I am going to stop asking for the outcome and start asking to be the kind of person who can hold on without one.',
  testimony: 'He has not explained it. He has kept me, and I am still here, and that is the thing I did not expect to be able to say.',
};

async function measure(driver, label) {
  const m = await driver.executeScript(`
    const body = document.querySelector('[class*=artifactBody]');
    const fields = [...document.querySelectorAll('[class*=field][class*=content], [class*=field]')].filter(n => n.className.includes('field') && !n.className.includes('field'+'Heading'));
    if (!body) return null;
    return {
      visible: Math.round(body.clientHeight),
      total: Math.round(body.scrollHeight),
      viewport: innerHeight,
    };
  `);
  if (!m) { console.log(`  ${label}: card not found`); return null; }
  const pct = Math.round((m.visible / m.total) * 100);
  console.log(`  ${label}: ${m.visible}px visible of ${m.total}px (${pct}%) — viewport ${m.viewport}px`);
  return { ...m, pct };
}

async function run(label, width, height) {
  const driver = await new Builder().forBrowser('chrome')
    .setChromeOptions(new chrome.Options().addArguments('--headless=new', '--no-sandbox', `--window-size=${width},${height}`))
    .build();
  try {
    console.log(`\n===== ${label} (${width}x${height}) =====`);
    await driver.get(`${WEB}/login`);
    await wait(1200);
    await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
    });
    await wait(400);

    for (const b of await driver.findElements(By.css('button'))) {
      if ((await b.getText()).includes('Create an account')) { await b.click(); break; }
    }
    await wait(300);
    await driver.findElement(By.css('#email')).sendKeys(`card${Date.now()}@example.com`);
    await driver.findElement(By.css('#password')).sendKeys('password123');
    await driver.findElement(By.css('button[type=submit]')).click();
    await wait(3500);

    if (width < 600) {
      for (const b of await driver.findElements(By.css('button'))) {
        if ((await b.getText()).trim() === 'Chat') { await b.click(); break; }
      }
      await wait(600);
    }
    const composer = await driver.findElement(By.css('textarea'));
    await composer.sendKeys('Reflecting on Romans 8:28 tonight.');
    await composer.sendKeys(Key.ENTER);
    await wait(2500);

    if (width < 600) {
      for (const b of await driver.findElements(By.css('button'))) {
        if ((await b.getText()).trim() === 'Reflect') { await b.click(); break; }
      }
      await wait(800);
    }

    /* Write all four, which is when the letterbox bites. */
    for (const [type, text] of Object.entries(SECTIONS)) {
      const area = await driver.findElements(By.css(`#chat-field-${type}`));
      if (!area.length) { console.log(`  no field for ${type}`); continue; }
      await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', area[0]);
      await area[0].sendKeys(text);
      await wait(150);
    }
    await wait(800);

    const m = await measure(driver, 'four sections written');
    await driver.executeScript('window.scrollTo(0, 0)');
    await wait(400);
    writeFileSync(new URL(`card-${label}-top.png`, OUT), await driver.takeScreenshot(), 'base64');
    await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
    await wait(400);
    writeFileSync(new URL(`card-${label}.png`, OUT), await driver.takeScreenshot(), 'base64');
    console.log(`  shots out/card-${label}-top.png and out/card-${label}.png`);
    return m;
  } finally {
    await driver.quit();
  }
}

await run('1280', 1280, 800);
await run('390', 390, 844);
