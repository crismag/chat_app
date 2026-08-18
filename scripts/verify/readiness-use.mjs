/*
 * The second half of the product tour: the app with something written in it.
 *
 * The empty states are one story and the populated ones are another. This
 * signs up, sends a first message so a reflection exists, then does the things
 * a first-time user would do — type a reference immediately afterwards, look
 * at the assistance controls, scroll the card — and photographs the result.
 *
 * It asserts almost nothing on purpose. The readiness claims are written from
 * the pictures; this exists so there are pictures to write them from.
 *
 *   node scripts/verify/readiness-use.mjs
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const WEB = 'http://localhost:5173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(driver, name) {
  writeFileSync(new URL(`use-${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
  console.log(`    shot out/use-${name}.png`);
}

async function until(fn, ms = 25000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* not there yet */
    }
    if (Date.now() > deadline) return false;
    await wait(250);
  }
}

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

async function run(label, width, height) {
  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(
      new chrome.Options().addArguments('--headless=new', '--no-sandbox', `--window-size=${width},${height}`),
    )
    .build();

  try {
    console.log(`\n=============== ${label} ===============`);
    await driver.get(`${WEB}/login`);
    await wait(1200);
    // Force the exact CSS viewport; --window-size is the outer window.
    await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
    });
    await wait(400);
    console.log('  viewport is', await driver.executeScript('return innerWidth + "x" + innerHeight'));

    for (const b of await driver.findElements(By.css('button'))) {
      if ((await b.getText()).includes('Create an account')) { await b.click(); break; }
    }
    await wait(300);
    await driver.findElement(By.css('#email')).sendKeys(`use${Date.now()}@example.com`);
    await driver.findElement(By.css('#password')).sendKeys('password123');
    await driver.findElement(By.css('button[type=submit]')).click();
    await wait(3000);
    console.log('  at', await driver.getCurrentUrl());

    if (width < 600) {
      // The composer lives behind the Chat tab on a phone.
      for (const b of await driver.findElements(By.css('button'))) {
        if ((await b.getText()).trim() === 'Chat') { await b.click(); break; }
      }
      await wait(600);
    }

    // ---- send the first message, which creates the reflection ----
    const composer = await driver.findElement(By.css('textarea'));
    await composer.sendKeys(
      'I am reflecting on Romans 8:28 and how hard it is to believe when nothing makes sense.',
    );
    await composer.sendKeys(Key.ENTER);
    await wait(600);
    const enterSent = (await composer.getAttribute('value')).trim() === '';
    console.log(`  ENTER SENDS THE MESSAGE: ${enterSent}`);
    if (!enterSent) {
      await driver.findElement(By.css('button[aria-label=Send]')).click();
    }
    console.log('  sent first message; waiting for a reply…');
    const replied = await until(async () => {
      const t = await driver.executeScript(VISIBLE, 'body');
      return /C\.H\.A\.T\./.test(t) && /Reflect on|✦/.test(t);
    }, 60000);
    console.log('  reply arrived:', replied);
    await wait(2500);
    await shoot(driver, `after-first-message-${label}`);

    // ---- identity fields immediately after create ----
    const title = await driver.findElements(By.css('input[aria-label="Reflection title"]'));
    console.log(`  title fields found: ${title.length}`);
    if (title.length) {
      await title[0].click();
      await title[0].sendKeys(Key.chord(Key.CONTROL, 'a'));
      await title[0].sendKeys('Romans 8:28');
      await wait(1200);
      const kept = await title[0].getAttribute('value');
      console.log(`  TITLE FIELD: typed "Romans 8:28", field now holds "${kept}"`);
      await shoot(driver, `title-typed-${label}`);
    }
    const passage = await driver.findElements(By.css('button[aria-expanded]'));
    console.log(`  expandable controls: ${passage.length}`);

    // ---- the assistance row under each section ----
    const assist = await driver.executeScript(`
      const rows = [...document.querySelectorAll('[class*=fieldActions], [class*=assist i]')];
      return rows.map((r) => ({
        cls: r.className.toString().slice(0, 40),
        buttons: [...r.querySelectorAll('button')].map(
          (b) => (b.innerText || b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim(),
        ),
      }));
    `);
    console.log('  assistance rows:', JSON.stringify(assist, null, 2));

    const buttonCount = await driver.executeScript(`
      return [...document.querySelectorAll('button')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length;
    `);
    console.log('  visible buttons on the page:', buttonCount);

    // ---- the card's scroll region ----
    const scrolls = await driver.executeScript(`
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.clientHeight > 30) {
          out.push({
            cls: el.className.toString().slice(0, 50) || el.tagName,
            visible: Math.round(el.clientHeight),
            total: Math.round(el.scrollHeight),
          });
        }
      }
      return out;
    `);
    console.log('  scroll regions:', JSON.stringify(scrolls, null, 2));

    console.log('  --- full visible text ---');
    console.log('  ' + (await driver.executeScript(VISIBLE, 'body')).slice(0, 4000));

    // ---- populated Reflections ----
    await driver.get(`${WEB}/reflections`);
    await wait(2500);
    console.log('\n  --- Reflections (populated) ---');
    console.log('  ' + (await driver.executeScript(VISIBLE, 'body')).slice(0, 1500));
    await shoot(driver, `reflections-full-${label}`);

    // ---- Create, now that a reflection exists ----
    await driver.get(`${WEB}/create`);
    await wait(2500);
    const opts = await driver.executeScript(`
      return [...document.querySelectorAll('select')].map((s) => ({
        name: s.getAttribute('aria-label') || s.name || s.id || '(unnamed)',
        options: [...s.options].map((o) => o.text),
      }));
    `);
    console.log('\n  --- Create selects ---');
    console.log('  ' + JSON.stringify(opts, null, 2));
    for (const b of await driver.findElements(By.css('button'))) {
      if ((await b.getText()).trim() === 'Preview') { await b.click(); break; }
    }
    await wait(2500);
    await shoot(driver, `create-preview-${label}`);
    console.log('  after Preview: ' + (await driver.executeScript(VISIBLE, 'body')).slice(0, 900));

    const severe = (await driver.manage().logs().get('browser')).filter(
      (e) => e.level.name === 'SEVERE' && !/favicon|auth\/me|auth\/login/.test(e.message),
    );
    console.log('\n  console errors:', severe.length || 'none');
    for (const e of severe) console.log('    ' + e.message.slice(0, 300));
  } finally {
    await driver.quit();
  }
}

await run('1280', 1280, 900);
await run('390', 390, 844);
console.log('\ndone');
