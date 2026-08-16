/*
 * A product tour, for looking rather than asserting.
 *
 * Every page of the app, signed in as a brand-new account, at desktop and phone
 * widths, plus a second pass with a reflection actually written so the empty
 * states and the populated states are both on record. It makes almost no
 * claims: it takes the pictures a readiness review has to be written from, and
 * prints the accessible names and console errors that a screenshot cannot show.
 *
 *   node scripts/verify/readiness-tour.mjs
 */
import { Builder, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const WEB = 'http://localhost:5173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const VISIBLE_TEXT = `
  const root = document.querySelector(arguments[0]) || document.body;
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3) { out.push(node.textContent); return; }
    if (node.nodeType !== 1) return;
    if (node.classList.contains('sr-only')) return;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out.join(' | ').replace(/\\s+/g, ' ').trim();
`;

const CONTROLS = `
  return [...document.querySelectorAll('button, a[href], input, textarea, select')].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
      aria: el.getAttribute('aria-label') || '',
      labelled: !!(el.labels && el.labels.length),
      id: el.id || '',
      disabled: !!el.disabled,
      w: Math.round(r.width), h: Math.round(r.height),
      hidden: cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0,
    };
  }).filter((c) => !c.hidden);
`;

async function shoot(driver, name) {
  writeFileSync(new URL(`tour-${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
  console.log(`    shot out/tour-${name}.png`);
}

async function report(driver, name, selector = 'body') {
  const text = await driver.executeScript(VISIBLE_TEXT, selector);
  console.log(`  --- ${name} visible text ---\n  ${text.slice(0, 2200)}`);
  const controls = await driver.executeScript(CONTROLS);
  const nameless = controls.filter(
    (c) => !c.text && !c.aria && !c.labelled && c.tag !== 'a',
  );
  console.log(`  controls: ${controls.length}, without an accessible name: ${nameless.length}`);
  for (const c of nameless) console.log(`    NAMELESS ${c.tag}#${c.id} ${c.w}x${c.h}`);
  const small = controls.filter((c) => c.tag === 'button' && (c.w < 24 || c.h < 24));
  for (const c of small) console.log(`    SMALL TARGET "${c.text || c.aria}" ${c.w}x${c.h}`);
}

async function console_errors(driver, where) {
  const severe = (await driver.manage().logs().get('browser')).filter(
    (e) => e.level.name === 'SEVERE' && !/favicon/.test(e.message),
  );
  if (severe.length) {
    console.log(`  CONSOLE (${where}):`);
    for (const e of severe) console.log(`    ${e.message.slice(0, 300)}`);
  }
}

async function build(width, height) {
  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(
      new chrome.Options().addArguments(
        '--headless=new',
        '--no-sandbox',
        `--window-size=${width},${height}`,
      ),
    )
    .build();
}

async function signUp(driver) {
  await driver.get(`${WEB}/login`);
  await wait(1500);
  const email = `tour${Date.now()}@example.com`;
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).includes('Create an account')) {
      await button.click();
      break;
    }
  }
  await wait(300);
  await driver.findElement(By.css('#email')).sendKeys(email);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  await driver.findElement(By.css('button[type=submit]')).click();
  await wait(3000);
  return email;
}

async function tour(label, width, height) {
  const driver = await build(width, height);
  try {
    console.log(`\n================ ${label} (${width}x${height}) ================`);

    await driver.get(`${WEB}/login`);
    await wait(1500);
    console.log('\n== AUTH (sign in) ==');
    await report(driver, 'auth-signin');
    await shoot(driver, `auth-signin-${label}`);

    for (const button of await driver.findElements(By.css('button'))) {
      if ((await button.getText()).includes('Create an account')) {
        await button.click();
        break;
      }
    }
    await wait(400);
    console.log('\n== AUTH (register) ==');
    await report(driver, 'auth-register');
    await shoot(driver, `auth-register-${label}`);

    // An empty submit, to see what the errors look like.
    await driver.findElement(By.css('button[type=submit]')).click();
    await wait(800);
    console.log('\n== AUTH (empty submit) ==');
    await report(driver, 'auth-error');
    await shoot(driver, `auth-error-${label}`);

    // A bad sign-in, to see the failure copy.
    await driver.get(`${WEB}/login`);
    await wait(1200);
    await driver.findElement(By.css('#email')).sendKeys('nobody@example.com');
    await driver.findElement(By.css('#password')).sendKeys('wrongpassword');
    await driver.findElement(By.css('button[type=submit]')).click();
    await wait(1500);
    console.log('\n== AUTH (bad credentials) ==');
    await report(driver, 'auth-bad');
    await shoot(driver, `auth-bad-${label}`);

    const email = await signUp(driver);
    console.log(`\n  signed up as ${email}; at ${await driver.getCurrentUrl()}`);

    console.log('\n== REFLECT (new, empty) ==');
    await report(driver, 'reflect-empty');
    await shoot(driver, `reflect-empty-${label}`);
    await console_errors(driver, 'reflect-empty');

    // Measure the card's scroll region, which is the complaint.
    const metrics = await driver.executeScript(`
      const out = {};
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 40) {
          const cs = getComputedStyle(el);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            out[el.className.toString().slice(0, 60) || el.tagName] =
              Math.round(el.clientHeight) + ' visible of ' + Math.round(el.scrollHeight);
          }
        }
      }
      return out;
    `);
    console.log('  scroll regions:', JSON.stringify(metrics, null, 2));

    console.log('\n== REFLECTIONS (empty) ==');
    await driver.get(`${WEB}/reflections`);
    await wait(1800);
    await report(driver, 'reflections-empty');
    await shoot(driver, `reflections-empty-${label}`);

    console.log('\n== COMMUNITY ==');
    await driver.get(`${WEB}/community`);
    await wait(1500);
    await report(driver, 'community');
    await shoot(driver, `community-${label}`);

    console.log('\n== CREATE ==');
    await driver.get(`${WEB}/create`);
    await wait(1800);
    await report(driver, 'create');
    await shoot(driver, `create-${label}`);
    await console_errors(driver, 'create');

    console.log('\n== /library redirect ==');
    await driver.get(`${WEB}/library`);
    await wait(1200);
    console.log('  landed at', await driver.getCurrentUrl());

    console.log('\n== unknown route /nope ==');
    await driver.get(`${WEB}/nope`);
    await wait(1200);
    console.log('  landed at', await driver.getCurrentUrl());
    await report(driver, 'unknown-route');
    await shoot(driver, `unknown-${label}`);

    await console_errors(driver, 'end');
  } finally {
    await driver.quit();
  }
}

await tour('1280', 1280, 900);
await tour('390', 390, 844);
console.log('\ndone');
