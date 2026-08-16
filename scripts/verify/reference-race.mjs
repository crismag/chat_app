/*
 * The Scripture reference that kept only its first character.
 *
 * The report: type a reference into the header field IMMEDIATELY after the
 * first message has created the reflection, and only the first character
 * survives — it saved as "R", and the next AI turn asked which book "R" was.
 * Typed before the first message it is fine.
 *
 * This script reproduces it rather than describing it. It instruments the input
 * with its own listeners first — focus, blur, input, and the React-driven value
 * changes — because the interesting event is the one nobody is watching for,
 * and a screenshot at the end would show a wrong value without showing why.
 *
 * Run it against the ordinary dev servers:
 *
 *   node scripts/verify/reference-race.mjs
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const REFERENCE = 'Romans 8:28';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function until(fn, ms = 15000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await wait(120);
  }
}

async function shoot(driver, name) {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
}

/**
 * Watch the field from inside the page.
 *
 * `blur` is the one that matters: the field commits on blur, so a blur that
 * arrives between two keystrokes writes a half-typed reference down as if the
 * author had finished. The native value setter is patched too, so a value the
 * author did not type — React re-rendering over them — is recorded as its own
 * kind of event rather than inferred afterwards from a mismatch.
 */
/** What the server actually has, asked of the server rather than of the page. */
async function storedReference(driver) {
  return driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    fetch('http://localhost:8000/api/conversations', { credentials: 'include' })
      .then((response) => response.json())
      .then((list) => done(list[0] ? list[0].scriptureReference : '(no reflection)'))
      .catch((caught) => done('(error) ' + caught.message));
  `);
}

const INSTRUMENT = `
  const input = document.querySelector('input[aria-label="Scripture reference"]');
  if (!input) return 'no-input';
  window.__refLog = [];
  const log = (kind, value) => window.__refLog.push({ kind, value, at: Date.now() });
  for (const kind of ['focus', 'blur', 'input']) {
    input.addEventListener(kind, () => log(kind, input.value), true);
  }
  const describe = (node) => {
    if (!(node instanceof Element)) return String(node);
    return node.tagName.toLowerCase() +
      (node.id ? '#' + node.id : '') +
      (node.getAttribute('aria-label') ? '[' + node.getAttribute('aria-label') + ']' : '') +
      (node.className && typeof node.className === 'string'
        ? '.' + node.className.split(' ')[0] : '');
  };
  document.addEventListener('focusin', (event) => {
    log('focusin:' + describe(event.target), input.value);
  }, true);
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  );
  Object.defineProperty(input, 'value', {
    get() { return descriptor.get.call(this); },
    set(next) {
      if (descriptor.get.call(this) !== next) log('react-set', next);
      descriptor.set.call(this, next);
    },
    configurable: true,
  });
  return 'ok';
`;

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

try {
  await driver.get('http://localhost:5173/login');
  await until(async () => (await driver.findElements(By.css('#email'))).length === 1);
  const email = `refrace${Date.now()}@example.com`;
  await driver.findElement(By.css('#email')).sendKeys(email);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).includes('Create an account')) {
      await button.click();
      break;
    }
  }
  await wait(400);
  await driver.findElement(By.css('button[type=submit]')).click();
  await until(async () => !/\/login/.test(await driver.getCurrentUrl()));

  const composer = By.css('textarea[aria-label="Write your reflection"]');
  await until(async () => (await driver.findElements(composer)).length === 1);

  /*
   * Accept the AI disclosure up front. The person who reported this had
   * accepted it long ago; leaving it to appear would put a modal scrim over the
   * field and reproduce a different, easier problem than the one reported.
   */
  await driver.executeScript(
    "window.localStorage.setItem('chat.ai.disclosure', 'accepted')",
  );
  await driver.navigate().refresh();
  await until(async () => (await driver.findElements(composer)).length === 1);
  const reference = () => driver.findElement(By.css('input[aria-label="Scripture reference"]'));

  console.log('\n— the reference, typed AFTER the first message ------------------');

  /*
   * Half a second of latency on every request.
   *
   * Not to make the test harder for its own sake. The window this bug lives in
   * is the one between "send" and the reflection existing, and on a developer's
   * loopback that window is a few milliseconds wide — which is why it has been
   * carried for a long time and never caught here. Half a second is an ordinary
   * mobile connection, and it is the condition the person who reported it was
   * actually working under.
   */
  await driver.setNetworkConditions({
    offline: false,
    latency: 500,
    download_throughput: 1024 * 1024,
    upload_throughput: 1024 * 1024,
  });

  console.log(`  instrument: ${await driver.executeScript(INSTRUMENT)}`);

  /*
   * The first message creates the reflection. Typing starts at once, without
   * waiting for it — which is the whole report.
   */
  await driver.findElement(composer).sendKeys('Starting a reflection.');
  const field = await reference();
  await driver.findElement(composer).sendKeys(Key.chord(Key.CONTROL, Key.ENTER));

  await field.click();
  for (const character of REFERENCE) {
    await field.sendKeys(character);
    await wait(300);
  }

  const typedInDom = await field.getAttribute('value');
  check('every character survived in the field', typedInDom === REFERENCE, `field="${typedInDom}"`);

  /* The log AS TYPING ENDED, before the deliberate blur below joins it. */
  const log = await driver.executeScript('return window.__refLog || []');
  const blurs = log.filter((entry) => entry.kind === 'blur');
  const reactSets = log.filter((entry) => entry.kind === 'react-set');
  console.log('\n  field event log while typing:');
  for (const entry of log) {
    if (entry.kind === 'keydown' || entry.kind === 'input') continue;
    console.log(`    ${entry.kind.padEnd(10)} value=${JSON.stringify(entry.value)}`);
  }
  check(
    'the field was not blurred while it was being typed into',
    blurs.length === 0,
    `${blurs.length} blur(s) mid-typing`,
  );
  check(
    'nothing rewrote the field under the author',
    reactSets.every((entry) => REFERENCE.startsWith(entry.value)),
    reactSets.map((entry) => JSON.stringify(entry.value)).join(' ') || 'none',
  );

  /* Commit it the way a person would, then let the save settle. */
  await driver.findElement(By.css('body')).click();
  await wait(2500);

  const stored = await storedReference(driver);
  check('the whole reference was saved', stored === REFERENCE, `stored=${JSON.stringify(stored)}`);

  await shoot(driver, 'reference-race-1280');

  console.log('\n— the reference, typed BEFORE the first message (the good path) --');

  /* A second reflection, the way that already worked, as the control. */
  for (const button of await driver.findElements(By.css('button'))) {
    const label = (await button.getAttribute('aria-label')) || (await button.getText());
    if (/new reflection/i.test(label)) {
      await button.click();
      break;
    }
  }
  await wait(600);
  const before = await reference();
  await before.click();
  for (const character of 'Psalm 23:1') {
    await before.sendKeys(character);
    await wait(70);
  }
  await driver
    .findElement(composer)
    .sendKeys('And another.', Key.chord(Key.CONTROL, Key.ENTER));
  await wait(2500);
  const storedBefore = await storedReference(driver);
  check(
    'typed before the first message, it still survives whole',
    storedBefore === 'Psalm 23:1',
    `stored=${JSON.stringify(storedBefore)}`,
  );

  await driver.manage().window().setRect({ width: 390, height: 844 });
  await wait(600);
  await shoot(driver, 'reference-race-390');
} finally {
  await driver.quit();
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
