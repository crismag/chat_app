/*
 * Three things the tour could not reach, all on the Reflect page:
 *
 *   1. the disclosure sheet that arrives on the first send, and what it covers;
 *   2. whether a reply actually lands from the live provider;
 *   3. the Scripture-reference field losing keystrokes typed immediately after
 *      the first message creates the reflection.
 *
 * It types the reference the way a person does — character by character, with
 * human-ish gaps — rather than setting the value, because setting the value is
 * precisely what hides this defect.
 *
 *   node scripts/verify/readiness-reference.mjs
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const WEB = 'http://localhost:5173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const VISIBLE = `
  const root = document.querySelector(arguments[0]) || document.body;
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.textContent); return; }
    if (n.nodeType !== 1) return;
    if (n.classList.contains('sr-only')) return;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out.join(' | ').replace(/\\s+/g, ' ').trim();
`;

async function shoot(driver, name) {
  writeFileSync(new URL(`ref-${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
  console.log(`    shot out/ref-${name}.png`);
}

async function until(fn, ms = 60000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return true; } catch { /* keep waiting */ }
    if (Date.now() > deadline) return false;
    await wait(300);
  }
}

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

try {
  await driver.get(`${WEB}/login`);
  await wait(1200);
  await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  for (const b of await driver.findElements(By.css('button'))) {
    if ((await b.getText()).includes('Create an account')) { await b.click(); break; }
  }
  await wait(300);
  await driver.findElement(By.css('#email')).sendKeys(`ref${Date.now()}@example.com`);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  await driver.findElement(By.css('button[type=submit]')).click();
  await wait(3000);

  const composer = await driver.findElement(By.css('textarea'));
  await composer.sendKeys('Reading Romans 8 today and wondering how to hold on to verse 28.');
  await driver.findElement(By.css('button[aria-label=Send]')).click();

  // The disclosure sheet, photographed before it is dismissed.
  const sheet = await until(async () => {
    const t = await driver.executeScript(VISIBLE, 'body');
    return /Before you use AI assistance/.test(t);
  }, 15000);
  console.log('  disclosure sheet appears on first send:', sheet);
  if (sheet) {
    await shoot(driver, 'disclosure-over-card');
    const covered = await driver.executeScript(`
      const sheets = [...document.querySelectorAll('[class*=sheet], [role=dialog]')];
      return sheets.map((s) => {
        const r = s.getBoundingClientRect();
        return { cls: s.className.toString().slice(0,40), role: s.getAttribute('role'),
                 modal: s.getAttribute('aria-modal'),
                 box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
      });
    `);
    console.log('  sheets on screen:', JSON.stringify(covered));
    for (const b of await driver.findElements(By.css('button'))) {
      if ((await b.getText()).includes('I understand')) { await b.click(); break; }
    }
  }

  console.log('  waiting for the live reply…');
  const replied = await until(async () => {
    const t = await driver.executeScript(VISIBLE, 'body');
    return /✦ C\.H\.A\.T\./.test(t) && !/is thinking/.test(t);
  }, 90000);
  console.log('  reply arrived:', replied);
  await wait(1500);
  await shoot(driver, 'reply-1280');

  // ---------- the reference field ----------
  const ref = await driver.findElement(By.css('input[aria-label="Scripture reference"]'));
  console.log('  reference field currently holds:', JSON.stringify(await ref.getAttribute('value')));

  await driver.navigate().refresh();
  await wait(3500);
  console.log('\n  == existing reflection: type the reference (the control case) ==');
  const ref2 = await driver.findElement(By.css('input[aria-label="Scripture reference"]'));
  await ref2.click();
  for (const ch of 'Romans 8:28') { await ref2.sendKeys(ch); await wait(60); }
  await wait(1500);
  console.log('  typed "Romans 8:28" →', JSON.stringify(await ref2.getAttribute('value')));

  // ---------- now the real case: a brand-new reflection ----------
  console.log('\n  == brand new reflection: send, then type the reference immediately ==');
  await driver.get(`${WEB}/?new=1`);
  await wait(2500);
  const composer2 = await driver.findElement(By.css('textarea'));
  await composer2.sendKeys('Sitting with Psalm 23 tonight.');
  await driver.findElement(By.css('button[aria-label=Send]')).click();
  await wait(150); // a person's hand moves to the reference box about now
  const ref3 = await driver.findElement(By.css('input[aria-label="Scripture reference"]'));
  await ref3.click();
  for (const ch of 'Psalm 23') { await ref3.sendKeys(ch); await wait(90); }
  await wait(3000);
  const kept = await driver.findElement(
    By.css('input[aria-label="Scripture reference"]'),
  ).getAttribute('value');
  console.log(`  typed "Psalm 23" immediately after send → field holds ${JSON.stringify(kept)}`);
  console.log(`  KEYSTROKES LOST: ${kept !== 'Psalm 23'}`);
  await shoot(driver, 'reference-after-send');

  await wait(2500);
  console.log('\n  what the server stored:');
  const stored = await driver.executeScript(`
    return fetch('/api/reflections', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => (d.reflections || d.items || d).map
        ? JSON.stringify((d.reflections || d.items || d).map((x) => ({ t: x.title, r: x.scriptureReference })))
        : JSON.stringify(d));
  `);
  console.log('  ' + stored);

  // ---------- the card's scroll region at 1280 ----------
  const scrolls = await driver.executeScript(`
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.clientHeight > 20) {
        out.push({ cls: el.className.toString().slice(0,45) || el.tagName,
                   visible: Math.round(el.clientHeight), total: Math.round(el.scrollHeight) });
      }
    }
    return out;
  `);
  console.log('\n  scroll regions at 1280:', JSON.stringify(scrolls, null, 2));

  // Fill every section so the card is as tall as a finished reflection.
  await driver.executeScript(`
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    };
    const filler = 'The Lord is my shepherd, I lack nothing. He makes me lie down in green pastures. '.repeat(4);
    return ['content','heart','application','testimony'].map((s) => set('chat-field-' + s, filler));
  `);
  await wait(2500);
  const scrolls2 = await driver.executeScript(`
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.clientHeight > 20) {
        out.push({ cls: el.className.toString().slice(0,45) || el.tagName,
                   visible: Math.round(el.clientHeight), total: Math.round(el.scrollHeight) });
      }
    }
    return out;
  `);
  console.log('  scroll regions with four full sections:', JSON.stringify(scrolls2, null, 2));
  await shoot(driver, 'card-full-1280');
  console.log('\n  ' + (await driver.executeScript(VISIBLE, 'body')).slice(0, 2500));
} finally {
  await driver.quit();
}
