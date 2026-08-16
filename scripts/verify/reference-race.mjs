/*
 * The Scripture reference that lost what was typed into it.
 *
 * The report: type a reference into the header field IMMEDIATELY after the
 * first message has created the reflection, and it comes back mangled — it
 * saved as "R", and the next AI turn asked which book "R" meant. Typed before
 * the first message it is fine.
 *
 * This script reproduces it rather than describing it. Three things it does
 * that an obvious version of it would not, each because the obvious version
 * passed against a live defect:
 *
 *   - It instruments the input from inside the page — focus, blur, and the
 *     React-driven value writes — because the interesting event is the one
 *     nobody watches for, and a wrong value in a screenshot does not say why.
 *   - It adds half a second of network latency. The window the bug lives in is
 *     between "send" and the reflection existing; on loopback that window is a
 *     few milliseconds wide, which is why this was carried for so long.
 *   - It sends the message BOTH ways, and repeats each case. Ctrl+Enter leaves
 *     focus in the composer; the Send button moves focus to a button first.
 *     They are not the same event, and an earlier version of this script tested
 *     only the shortcut, passed, and missed that the button still lost
 *     characters. It also runs a SECOND reflection, because "the first thing
 *     after signing in" is the least ordinary path there is.
 *
 * Run it against the ordinary dev servers:
 *
 *   node scripts/verify/reference-race.mjs
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
/** Each trial gets its own so a stale value cannot be mistaken for a pass. */
const REFERENCES = ['Romans 8:28', 'Psalm 23:1', 'Jonah 2:2', 'Micah 6:8'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function until(fn, ms = 20000) {
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

/**
 * Watch the field from inside the page.
 *
 * `blur` matters because the field commits on blur: a blur between two
 * keystrokes writes a half-typed reference down as though it were finished.
 * `react-set` matters more — it records a value the author did not type, which
 * is React re-rendering over them, and it is what this defect actually was.
 */
const INSTRUMENT = `
  const input = document.querySelector('input[aria-label="Scripture reference"]');
  if (!input) return 'no-input';
  /* One set of listeners per element, however many times this is injected. */
  if (input.__instrumented) { window.__refLog = []; return 'already'; }
  input.__instrumented = true;
  window.__refLog = [];
  const log = (kind, value) => window.__refLog.push({ kind, value, at: Date.now() });
  for (const kind of ['focus', 'blur', 'input']) {
    input.addEventListener(kind, () => log(kind, input.value), true);
  }
  const describe = (node) => {
    if (!(node instanceof Element)) return String(node);
    return node.tagName.toLowerCase() +
      (node.getAttribute('aria-label') ? '[' + node.getAttribute('aria-label') + ']' : '');
  };
  document.addEventListener('focusin', (event) => {
    log('focusin:' + describe(event.target), input.value);
  }, true);
  /*
   * Who moves focus into the composer, and what the URL was when they did.
   *
   * composerRef.current.focus() is called from exactly two places in
   * ChatPage, so catching the call at all narrows it to two; the URL beside it
   * decides which.
   */
  const nativeFocus = window.HTMLTextAreaElement.prototype.focus;
  window.HTMLTextAreaElement.prototype.focus = function patched() {
    log('composer-focus at ' + location.pathname + location.search, input.value);
    return nativeFocus.apply(this, arguments);
  };
  const replaceState = history.replaceState;
  history.replaceState = function () {
    log('url->' + String(arguments[2]), input.value);
    return replaceState.apply(this, arguments);
  };
  const pushState = history.pushState;
  history.pushState = function () {
    log('url->' + String(arguments[2]), input.value);
    return pushState.apply(this, arguments);
  };
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

const composer = By.css('textarea[aria-label="Write your reflection"]');
const referenceField = By.css('input[aria-label="Scripture reference"]');

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

/** Start a blank reflection, the way the New button does. */
async function startNew() {
  for (const button of await driver.findElements(By.css('button'))) {
    const label = (await button.getAttribute('aria-label')) || (await button.getText());
    if (/new reflection/i.test(label)) {
      await button.click();
      return true;
    }
  }
  return false;
}

/**
 * One trial: send the first message, then type the reference into the header
 * while the reflection is coming into existence.
 */
async function typeAfterSend({ how, reference, message }) {
  console.log(`  instrument: ${await driver.executeScript(INSTRUMENT)}`);

  await driver.findElement(composer).sendKeys(message);
  const field = await driver.findElement(referenceField);
  if (how === 'button') {
    await driver.findElement(By.css('button[aria-label="Send"]')).click();
  } else {
    await driver.findElement(composer).sendKeys(Key.chord(Key.CONTROL, Key.ENTER));
  }

  await field.click();
  for (const character of reference) {
    /*
     * Re-found every keystroke. Not defensive coding: the element goes stale
     * mid-word, which is itself a finding — a controlled input that React
     * unmounts and replaces loses its DOM value and its focus with it.
     */
    try {
      await driver.findElement(referenceField).sendKeys(character);
    } catch {
      await driver.executeScript("window.__refLog.push({ kind: 'element-replaced', value: '' })");
      const again = await driver.findElement(referenceField);
      await again.click();
      await again.sendKeys(character);
    }
    await wait(300);
  }

  const inField = await driver.findElement(referenceField).getAttribute('value');
  const log = await driver.executeScript('return window.__refLog || []');
  const rewrites = log
    .filter((entry) => entry.kind === 'react-set')
    .map((entry) => entry.value);
  const blurs = log.filter((entry) => entry.kind === 'blur').length;
  console.log('  event log while typing:');
  for (const entry of log) {
    if (entry.kind === 'input') continue;
    console.log(`    ${entry.kind.slice(0, 300)}  value=${JSON.stringify(entry.value)}`);
  }

  /* Commit it the way a person would, then let the save settle. */
  await driver.findElement(By.css('body')).click();
  await wait(2500);
  const stored = await storedReference(driver);

  return { inField, stored, rewrites, blurs };
}

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
  await until(async () => (await driver.findElements(composer)).length === 1);

  /*
   * Accept the AI disclosure up front. The person who reported this accepted it
   * long ago; leaving it to appear would put a modal scrim over the field and
   * reproduce a different, easier problem than the one reported.
   */
  await driver.executeScript("window.localStorage.setItem('chat.ai.disclosure', 'accepted')");
  await driver.navigate().refresh();
  await until(async () => (await driver.findElements(composer)).length === 1);

  await driver.setNetworkConditions({
    offline: false,
    latency: 500,
    download_throughput: 1024 * 1024,
    upload_throughput: 1024 * 1024,
  });

  /*
   * Four trials: both ways of sending, on the first reflection of the session
   * and on a later one. The report was reproduced nine times out of nine on a
   * SECOND reflection with the Send button, so neither dimension is decoration.
   */
  const trials = [
    { how: 'keyboard', label: 'first reflection, Ctrl+Enter' },
    { how: 'button', label: 'first reflection, Send button' },
    { how: 'keyboard', label: 'later reflection, Ctrl+Enter' },
    { how: 'button', label: 'later reflection, Send button' },
  ];

  for (const [index, trial] of trials.entries()) {
    const reference = REFERENCES[index];
    console.log(`\n— ${trial.label} —————————————————————————`);

    if (index > 0) {
      if (!(await startNew())) throw new Error('no New reflection control');
      await until(async () => (await driver.findElement(referenceField).getAttribute('value')) === '');
    }

    const outcome = await typeAfterSend({
      how: trial.how,
      reference,
      message: `Starting reflection ${index + 1}.`,
    });

    if (outcome.rewrites.length) {
      console.log(`  rewritten under the author: ${outcome.rewrites.map((v) => JSON.stringify(v)).join(' ')}`);
    }
    if (outcome.blurs) console.log(`  blurred mid-typing: ${outcome.blurs}`);

    check(
      `${trial.label}: every character survived on screen`,
      outcome.inField === reference,
      `field=${JSON.stringify(outcome.inField)}`,
    );
    check(
      `${trial.label}: the whole reference was saved`,
      outcome.stored === reference,
      `stored=${JSON.stringify(outcome.stored)}`,
    );
  }

  await shoot(driver, 'reference-race-1280');

  console.log('\n— the control: typed BEFORE the first message ——————————————');

  if (!(await startNew())) throw new Error('no New reflection control');
  await until(async () => (await driver.findElement(referenceField).getAttribute('value')) === '');
  const before = await driver.findElement(referenceField);
  await before.click();
  for (const character of 'Habakkuk 3:17') {
    await before.sendKeys(character);
    await wait(120);
  }
  await driver.findElement(composer).sendKeys('And another.', Key.chord(Key.CONTROL, Key.ENTER));
  await wait(2500);
  check(
    'typed before the first message, it still survives whole',
    (await storedReference(driver)) === 'Habakkuk 3:17',
  );

  await driver.manage().window().setRect({ width: 390, height: 844 });
  await wait(800);
  await shoot(driver, 'reference-race-390');
} finally {
  await driver.quit();
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
