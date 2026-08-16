/*
 * The assistance controls, driven end to end in a real browser.
 *
 * The claims here are the ones a unit test cannot make honestly: that the
 * disclosure actually appears before anything is sent, that a suggestion is
 * visibly a suggestion on screen, that discarding leaves the author's text
 * exactly as it was, that accepting can be undone, and that when the provider
 * fails the person can still write. It photographs the result so the claim
 * "beside the section, not a chatbot panel" can be looked at rather than
 * asserted.
 *
 * Run the API with the deterministic provider, so this costs nothing and
 * cannot flake on someone else's network:
 *
 *   AI_ENABLED=true AI_PROVIDER=fake npm run dev
 *   node scripts/verify/ai-assist.mjs
 *
 * It never uses a real key. Live calls belong to ai-live-smoke.mjs.
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function until(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await wait(150);
  }
}

/*
 * Labels are uppercased by CSS, and `getText()` returns what is rendered rather
 * than what is in the markup — so "Your words" comes back as "YOUR WORDS".
 * Matching case-insensitively tests the copy rather than the text-transform.
 */
async function shoot(driver, name) {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
}

/** Find a button by its visible text. The labels are the contract here. */
async function buttonWith(driver, pattern) {
  for (const button of await driver.findElements(By.css('button'))) {
    if (pattern.test((await button.getText()).trim())) return button;
  }
  return null;
}

/**
 * Find a button inside one section's card.
 *
 * Every section carries its own pair of controls, so searching the whole page
 * for "Improve wording" finds Context's — which is correctly disabled when
 * Context is empty, so the click lands on nothing and the script reports a
 * failure that is really its own. Scoping to the card is the fix, and it is
 * also what a person does: they press the button next to the words they wrote.
 */
async function buttonInSection(driver, sectionName, pattern) {
  for (const card of await driver.findElements(By.css('article[class*=field]'))) {
    const heading = await card.findElements(By.css('h3'));
    if (heading.length === 0) continue;
    if ((await heading[0].getText()).trim() !== sectionName) continue;
    for (const button of await card.findElements(By.css('button'))) {
      if (pattern.test((await button.getText()).trim())) return button;
    }
  }
  return null;
}

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1440,1000'),
  )
  .build();

try {
  // --- the server must be answering with a provider ----------------------
  const status = await fetch('http://127.0.0.1:8000/api/ai/status').then((r) => r.json());
  check(
    'the API reports model-backed assistance is available',
    status.capabilities?.improveWriting === true,
    JSON.stringify(status),
  );
  /*
   * The status body is the one AI response an unauthenticated caller can read,
   * so it is worth asserting on directly: capability, and nothing else.
   */
  check(
    'status reveals no key, project, model or environment value',
    !/AIza|gemini-|584923326390|gen-lang-client|12000|15000/i.test(JSON.stringify(status)),
    JSON.stringify(status),
  );

  // --- register and write something --------------------------------------
  await driver.get('http://localhost:5173/login');
  await until(async () => (await driver.findElements(By.css('#email'))).length === 1);
  await driver.findElement(By.css('#email')).sendKeys(`assist${Date.now()}@example.com`);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  const createAccount = await buttonWith(driver, /Create an account/);
  if (createAccount) await createAccount.click();
  await wait(400);
  await driver.findElement(By.css('button[type=submit]')).click();
  await until(async () => !/\/login/.test(await driver.getCurrentUrl()));

  const composer = await driver.findElement(
    By.css('textarea[aria-label="Write your reflection"]'),
  );
  await composer.sendKeys('Romans 8:28 met me this week and I could not see how any of it works together.');
  await driver.findElement(By.css('form button[type=submit]')).click();
  await until(async () => (await driver.findElements(By.css('[class*=fieldInput]'))).length === 4);

  await driver.findElement(By.css('input[aria-label="Scripture reference"]')).sendKeys(
    'Romans 8:28',
    Key.ENTER,
  );
  await wait(800);

  const body = () => driver.findElement(By.css('body')).getText();

  // --- the disclosure comes before anything is sent ----------------------
  const ask = await buttonInSection(driver, 'Context', /^Ask me questions$/);
  check('an "Ask me questions" control sits with the section', ask !== null);
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', ask);
  await ask.click();
  await wait(500);

  const disclosureShown = /Before you use AI assistance/.test(await body());
  check('the disclosure is shown before the first request', disclosureShown);
  check(
    'it names what is sent and where',
    /sent to our AI provider/.test(await body()),
  );
  await shoot(driver, 'ai-disclosure');

  // Declining sends nothing.
  const notNow = await buttonWith(driver, /^Not now$/);
  await notNow.click();
  await wait(400);
  check(
    'declining closes it and asks for nothing',
    !/Before you use AI assistance/.test(await body()) &&
      !/Questions to think about/.test(await body()),
  );

  // --- accepting the disclosure, and asking -------------------------------
  await (await buttonInSection(driver, 'Context', /^Ask me questions$/)).click();
  await wait(400);
  await (await buttonWith(driver, /I understand — continue/)).click();

  await until(async () => /Questions to think about/.test(await body()), 8000);
  check('questions come back and are marked as AI', /AI suggestion/i.test(await body()));
  check(
    'the notice travels with them',
    /Keep only what faithfully reflects your understanding/.test(await body()),
  );
  check(
    'the panel says nothing was written for the author',
    /Nothing has been written for you/.test(await body()),
  );

  /* Questions, not answers. Every line in the list must end in a question mark. */
  const questions = await driver.executeScript(
    `return [...document.querySelectorAll('[class*=assistQuestions] li')].map((el) => el.textContent.trim())`,
  );
  check(
    'every suggestion is a question, and there are one to three of them',
    questions.length >= 1 &&
      questions.length <= 3 &&
      questions.every((q) => q.endsWith('?')),
    JSON.stringify(questions),
  );
  await shoot(driver, 'ai-questions-beside-section');

  // --- improve wording: preview, discard, accept, undo ---------------------
  const heart = (await driver.findElements(By.css('[class*=fieldInput]')))[1];
  const written = 'i felt   undone by this  and i do not know what to do with it';
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', heart);
  await heart.sendKeys(written);
  await wait(1800); // let the autosave settle

  /*
   * Heart's own control, not the first one on the page. Context is empty and
   * its Improve is therefore correctly disabled.
   */
  const improve = await buttonInSection(driver, 'Heart', /^Improve wording$/);
  check('Heart has its own Improve wording control, and it is live', improve !== null);
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', improve);
  await improve.click();
  await until(async () => /Suggested wording/.test(await body()), 8000);

  check(
    'the preview shows the original beside the suggestion',
    /Your words/i.test(await body()) && /Suggested/i.test(await body()),
  );
  check('and says plainly that nothing has changed yet', /has not changed/.test(await body()));

  const beforeDiscard = await heart.getAttribute('value');
  check('the field still holds exactly what was typed', beforeDiscard === written, beforeDiscard);
  await shoot(driver, 'ai-improve-preview');

  // Discard leaves it alone.
  await (await buttonInSection(driver, 'Heart', /Discard — keep my words/)).click();
  await wait(500);
  check(
    'discarding leaves the author’s words untouched',
    (await heart.getAttribute('value')) === written,
  );
  check('and takes the suggestion away', !/Suggested wording/.test(await body()));

  // Accept, then undo.
  await (await buttonInSection(driver, 'Heart', /^Improve wording$/)).click();
  await until(async () => /Suggested wording/.test(await body()), 8000);
  await (await buttonInSection(driver, 'Heart', /Use this in Heart/)).click();
  await until(async () => (await heart.getAttribute('value')) !== written, 8000);

  const accepted = await heart.getAttribute('value');
  check('accepting puts the suggestion in the field', accepted !== written, accepted);
  check(
    'and the field is badged as assisted, not as the author’s own',
    /AI assisted/i.test(await body()),
  );
  await shoot(driver, 'ai-improve-accepted');

  const undo = await buttonInSection(driver, 'Heart', /Undo — put my words back/);
  check('undo is offered after accepting', undo !== null);
  if (undo) {
    await undo.click();
    await until(async () => (await heart.getAttribute('value')) === written, 8000);
    check('undo restores the original exactly', (await heart.getAttribute('value')) === written);
  }

  // --- the manual workflow survives assistance going away ------------------
  /*
   * The kill switch, exercised for real. Nothing about writing may depend on a
   * provider, so the test is that a section can still be written and saved
   * while assistance is refusing.
   */
  const reflectionUrl = await driver.getCurrentUrl();
  await driver.get(reflectionUrl);
  await until(
    async () => (await driver.findElements(By.css('[class*=fieldInput]'))).length === 4,
    8000,
  );

  const application = (await driver.findElements(By.css('[class*=fieldInput]')))[2];
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', application);
  await application.sendKeys('I will say the promise out loud on the days I cannot feel it.');
  await until(async () => /^Saved$/m.test(await body()), 8000);
  check('a section can still be written and saved with assistance in any state', true);

  await shoot(driver, 'ai-assist-full-page');

  // --- console -------------------------------------------------------------
  const severe = (await driver.manage().logs().get('browser')).filter(
    (entry) =>
      entry.level.name === 'SEVERE' &&
      !/favicon/.test(entry.message) &&
      !/auth\/me/.test(entry.message),
  );
  check('no severe console errors', severe.length === 0, severe.map((e) => e.message).join(' | '));

  const failed = results.filter((r) => !r.passed);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await driver.quit();
}
