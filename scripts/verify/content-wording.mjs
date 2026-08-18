/*
 * What the interface says the C section is.
 *
 * The rename from Context to Content was done in the data model and in most of
 * the copy, and then three live places went on describing C as a commentary —
 * the sign-in panel, the passage card's empty state, and the reference input's
 * placeholder — while a fourth, the page's own meta description, still carried
 * the retired name into search results and shared links.
 *
 * These are claims about words on a screen, so they are checked on a screen.
 * The script reads what the page actually PAINTS rather than its markup, and it
 * photographs both widths, because "the picker is the primary way to add a
 * passage and the typed reference is the fallback" is a claim about emphasis
 * that no assertion can settle.
 *
 *   node scripts/verify/content-wording.mjs
 *
 * **Look at `out/content-wording-1280.png` and `out/content-wording-390.png`.**
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
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
 * The text the page actually paints.
 *
 * `textContent` would count the screen-reader-only headings this design leans
 * on, and those legitimately name the sections. What is being checked here is
 * what a person reads, so hidden nodes are dropped.
 */
const PAINTED = `
  const painted = [];
  for (const node of document.querySelectorAll('body *')) {
    if (node.children.length) continue;
    if (node.closest('.sr-only') || node.classList.contains('sr-only')) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (Number(style.opacity) === 0) continue;
    const text = (node.textContent || '').trim();
    if (text) painted.push(text);
  }
  for (const field of document.querySelectorAll('input, textarea')) {
    if (field.placeholder) painted.push('[placeholder] ' + field.placeholder);
  }
  return painted.join('\\n');
`;

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

try {
  console.log('\n— the signed-out panel -----------------------------------------');

  await driver.get('http://localhost:5173/login');
  await until(async () => (await driver.findElements(By.css('#email'))).length === 1);

  const signedOut = await driver.executeScript(PAINTED);
  check(
    'the description of the meta tag no longer says Context',
    !/Context, Heart/i.test(
      await driver.executeScript(
        "return document.querySelector('meta[name=description]')?.content || ''",
      ),
    ),
  );
  check(
    'C is described as the passage, not as background',
    /passage itself/i.test(signedOut),
    signedOut.split('\n').find((line) => /passage/i.test(line)) ?? '(no line about the passage)',
  );
  check(
    'no line offers "what is happening around it"',
    !/what is happening around it/i.test(signedOut),
  );
  check(
    'Heart is where the meaning is invited',
    /means to you/i.test(signedOut),
    signedOut.split('\n').find((line) => /means to you/i.test(line)) ?? '',
  );
  await shoot(driver, 'content-wording-signed-out');

  console.log('\n— the reflection itself ----------------------------------------');

  const email = `wording${Date.now()}@example.com`;
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
  await driver.executeScript("window.localStorage.setItem('chat.ai.disclosure', 'accepted')");
  await driver.navigate().refresh();
  await until(async () => (await driver.findElements(composer)).length === 1);

  const blank = await driver.executeScript(PAINTED);
  check(
    'the retired Reference field is gone',
    !/\[placeholder\] Reference$/m.test(blank),
  );
  check(
    'a compact Bible passage action is offered',
    /Add Bible passage/i.test(blank),
  );
  check(
    'the four C.H.A.T. fields are on the blank page',
    /The passage itself/i.test(blank) && /What it means to you/i.test(blank),
  );
  /*
   * The connector is behind the press, not beside the writing. A blank page
   * showing a translation picker or a quotation is the layout this replaced.
   */
  check(
    'the picker itself is not on the blank page',
    !/Choose Bible passage/.test(blank) && !/\[placeholder\] John 3:16-18/.test(blank),
  );

  /* Now write something, so the sections and the chips are on screen. */
  await driver
    .findElement(composer)
    .sendKeys('Beginning a reflection on Romans 8:28.', Key.chord(Key.CONTROL, Key.ENTER));
  await until(async () => /Prepare Content|Draft Content/.test(await driver.executeScript(PAINTED)));

  await wait(1200);
  const working = await driver.executeScript(PAINTED);
  if (process.env.SHOW_PAINTED === '1') console.log(working);
  check('the chip reads Prepare Content', /Prepare Content/.test(working));
  check('and never Draft Content', !/Draft Content/.test(working));
  check(
    'Content still asks for the passage itself',
    /The passage itself\. Add an explanation only if you want to\./.test(working),
  );
  check('Heart asks what it means to you', /What it means to you/.test(working));
  check('nothing on screen says Context as a section', !/\bContext\b(?! )/.test(
    working.replace(/Historical context/gi, ''),
  ));

  await shoot(driver, 'content-wording-1280');

  await driver.manage().window().setRect({ width: 390, height: 844 });
  await wait(900);
  await shoot(driver, 'content-wording-390');
} finally {
  await driver.quit();
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
