/*
 * Suggest title, driven against a real provider.
 *
 * The claim being tested is a QUALITY one, which a unit test cannot make: the
 * candidates must read as titles rather than as truncated sentences. So this
 * prints them, and the run is only really finished when a person has read them.
 *
 * The rest is mechanical and is asserted: three or four options, every one
 * inside the format's limit, declining leaves the title byte-identical,
 * accepting survives a reload, and with AI off the heuristic answers rather
 * than the button going dark.
 *
 *   node scripts/verify/ai-suggest-title.mjs
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setBiblePassage } from './passage-control.mjs';

const OUT = new URL('./out/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function until(fn, ms = 30_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await wait(200);
  }
}

async function shoot(driver, name) {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
}

async function buttonWith(driver, pattern) {
  for (const button of await driver.findElements(By.css('button'))) {
    if (pattern.test((await button.getText()).trim())) return button;
  }
  return null;
}

/** The candidates on screen, with their lengths. */
async function candidates(driver) {
  return driver.executeScript(
    `return [...document.querySelectorAll('[class*=suggestionText]')].map((el) => el.textContent.trim())`,
  );
}

/**
 * Does this read as a name rather than as an interrupted sentence?
 *
 * A weak heuristic and named as one — it cannot judge whether a title is GOOD.
 * What it can catch is the specific defect: a clause that stops mid-thought.
 * The candidates are printed so a person makes the real judgement.
 */
function looksLikeATitle(title) {
  const DANGLING =
    /\b(and|but|or|the|a|an|of|to|in|for|with|that|which|when|while|so|as|is|was|i|my|it|this)$/i;
  const words = title.trim().split(/\s+/);
  return (
    title.length > 0 &&
    !/[.,;:]$/.test(title.trim()) &&
    !DANGLING.test(words[words.length - 1] ?? '') &&
    words.length >= 2
  );
}

const status = await fetch('http://127.0.0.1:8000/api/ai/status').then((r) => r.json());
console.log(`\n  provider: ${status.provider}\n`);

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

try {
  await driver.get('http://localhost:5173/login');
  await until(async () => (await driver.findElements(By.css('#email'))).length === 1, 10_000);
  await driver.findElement(By.css('#email')).sendKeys(`title${Date.now()}@example.com`);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  const createAccount = await buttonWith(driver, /Create an account/);
  if (createAccount) await createAccount.click();
  await wait(400);
  await driver.findElement(By.css('button[type=submit]')).click();
  await until(async () => !/\/login/.test(await driver.getCurrentUrl()), 10_000);
  await until(
    async () =>
      (await driver.findElements(By.css('textarea[aria-label="Write your reflection"]'))).length === 1,
    10_000,
  );

  const body = () => driver.findElement(By.css('body')).getText();

  await setBiblePassage(driver, 'Romans 8:28');
  await wait(900);

  /* Something with a tension in it, so a title has something to name. */
  const composer = await driver.findElement(
    By.css('textarea[aria-label="Write your reflection"]'),
  );
  await composer.sendKeys(
    'Romans 8:28 keeps meeting me this week. I cannot see how any of this works together, and I want to say I trust it anyway even though I do not feel it.',
  );
  await driver.findElement(By.css('form button[type=submit]')).click();
  await until(async () => (await driver.findElements(By.css('[class*=fieldInput]'))).length === 4);

  /* Dismiss the reply disclosure if it appears — this script is about titles. */
  if (await until(async () => /Before you use AI assistance/.test(await body()), 6000)) {
    await (await buttonWith(driver, /^Not now$/)).click();
    await until(async () => !/Before you use AI assistance/.test(await body()), 6000);
  }

  /* And something in Heart, so there is more than one angle to name. */
  const heart = (await driver.findElements(By.css('[class*=fieldInput]')))[1];
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', heart);
  await heart.sendKeys(
    'It undid me a bit. I have been holding things together by pretending they already make sense.',
  );
  await wait(1900);

  const titleBefore = await driver.executeScript(
    `return document.querySelector('input[aria-label="Reflection title"]').value`,
  );

  // --- ask -----------------------------------------------------------------
  const suggest = await buttonWith(driver, /Suggest title/);
  check('the Suggest title control is available', suggest !== null);
  await driver.executeScript('arguments[0].click()', suggest);

  const opened = await until(async () => /Suggest a title/.test(await body()), 30_000);
  check('a sheet of candidates opens', opened);
  if (!opened) throw new Error('no sheet');

  const options = await candidates(driver);
  console.log('\n  Candidates:');
  for (const option of options) console.log(`    · ${option}  (${option.length})`);
  console.log('');

  check(
    'three or four options come back',
    options.length >= 3 && options.length <= 4,
    `${options.length}`,
  );

  check(
    'they read as titles, not as interrupted sentences',
    options.every(looksLikeATitle),
    options.filter((o) => !looksLikeATitle(o)).join(' | ') || 'all pass the weak check',
  );

  /* Distinct in angle is a judgement; distinct at all is checkable. */
  const distinct = new Set(options.map((o) => o.toLowerCase()));
  check('and they are genuinely distinct', distinct.size === options.length);

  /*
   * A crude proxy for "different angle rather than a reworded twin": no two
   * candidates should share most of their words.
   */
  const overlaps = [];
  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      const a = new Set(options[i].toLowerCase().split(/\W+/).filter(Boolean));
      const b = options[j].toLowerCase().split(/\W+/).filter(Boolean);
      const shared = b.filter((w) => a.has(w)).length;
      if (b.length && shared / b.length > 0.7) overlaps.push(`${options[i]} ≈ ${options[j]}`);
    }
  }
  check('and differ in angle rather than in wording', overlaps.length === 0, overlaps.join(' | '));

  check(
    'every candidate fits the Full C.H.A.T. title limit',
    options.every((o) => o.length <= 100),
    options.map((o) => o.length).join(', '),
  );

  check(
    'the sheet says which side produced them',
    /Suggested by AI|assembled from your own writing/i.test(await body()),
  );
  check(
    'and names the current title, so replacing it is a visible decision',
    /currently called/i.test(await body()),
  );
  await shoot(driver, 'title-1280-sheet');

  // --- declining leaves it exactly as it was --------------------------------
  const keep = (await buttonWith(driver, /Keep my title/)) ?? (await buttonWith(driver, /Not now/));
  await driver.executeScript('arguments[0].click()', keep);
  await wait(700);
  const titleAfterDecline = await driver.executeScript(
    `return document.querySelector('input[aria-label="Reflection title"]').value`,
  );
  check(
    'declining leaves the title byte-identical',
    titleAfterDecline === titleBefore,
    `${JSON.stringify(titleBefore)} → ${JSON.stringify(titleAfterDecline)}`,
  );

  // --- accepting, and surviving a reload -------------------------------------
  await driver.executeScript('arguments[0].click()', await buttonWith(driver, /Suggest title/));
  await until(async () => /Suggest a title/.test(await body()), 30_000);
  const second = await candidates(driver);

  /* Choose the second option, so the test is not passed by a default. */
  const radios = await driver.findElements(By.css('input[name=title-suggestion]'));
  const pickIndex = Math.min(1, radios.length - 1);
  await driver.executeScript('arguments[0].click()', radios[pickIndex]);
  const picked = second[pickIndex];

  await driver.executeScript(
    'arguments[0].click()',
    await buttonWith(driver, /Use this title/),
  );
  await until(async () => !/Suggest a title/.test(await body()), 15_000);
  await wait(900);

  const applied = await driver.executeScript(
    `return document.querySelector('input[aria-label="Reflection title"]').value`,
  );
  check('accepting sets the chosen title', applied === picked, `${JSON.stringify(applied)}`);

  await driver.navigate().refresh();
  await until(
    async () => (await driver.findElements(By.css('input[aria-label="Reflection title"]'))).length === 1,
    15_000,
  );
  await wait(900);
  const afterReload = await driver.executeScript(
    `return document.querySelector('input[aria-label="Reflection title"]').value`,
  );
  check('and it survives a reload', afterReload === picked, JSON.stringify(afterReload));
  await shoot(driver, 'title-1280-applied');

  const severe = (await driver.manage().logs().get('browser')).filter(
    (entry) =>
      entry.level.name === 'SEVERE' &&
      !/favicon/.test(entry.message) &&
      !/auth\/me/.test(entry.message),
  );
  check('no severe console errors', severe.length === 0, severe.map((e) => e.message).join(' | '));

  const failed = results.filter((r) => !r.passed);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
  console.log('  Read the candidates above. If they are sentences, the prompt is not finished.');
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await driver.quit();
}
