/*
 * Does anything on Reflect destroy what the author wrote?
 *
 * The owner reported that buttons with no visible effect were also clearing
 * work in progress. This script does not reason about that — it types a
 * sentence into a section, presses every control on the page one at a time,
 * and reads the sentence back after each press. A control that loses it fails
 * here by name.
 *
 * It then checks the things that were missing rather than broken: a save state
 * that can be seen, a delete that really deletes, a format that survives a
 * reload, a title and a Scripture reference that can be set at all, and a share
 * sheet that says which field is at fault when the format gate refuses.
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

async function until(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await wait(150);
  }
}

const SENTENCE = 'I will pray before I react to my brother this week.';

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

async function shoot(name) {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
}

/** Everything the author's writing might be sitting in, as one string. */
async function writingOnScreen() {
  return driver.executeScript(`
    const areas = [...document.querySelectorAll('textarea, input')].map((t) => t.value);
    return areas.join('\\u0000') + '\\u0000' + document.body.innerText;
  `);
}

async function clickByText(label) {
  for (const button of await driver.findElements(By.css('button'))) {
    if (!(await button.isDisplayed())) continue;
    const text = (await button.getText()).trim();
    if (text === label || text.startsWith(label)) {
      await driver.executeScript('arguments[0].click()', button);
      return true;
    }
  }
  return false;
}

/** The textarea for one named section of the artifact. */
async function fieldArea(name) {
  const areas = await driver.findElements(By.css('textarea'));
  for (const area of areas) {
    const label = (await area.getAttribute('aria-label')) ?? '';
    if (label.startsWith(`${name} —`)) return area;
  }
  return null;
}

async function saveStateText() {
  const nodes = await driver.findElements(By.css('[class*=saveState]'));
  return nodes.length ? (await nodes[0].getText()).trim() : '';
}

try {
  // --- register ---------------------------------------------------------
  await driver.get('http://localhost:5173/login');
  await until(async () => (await driver.findElements(By.css('#email'))).length === 1);
  await driver.findElement(By.css('#email')).sendKeys(`integrity${Date.now()}@example.com`);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  await clickByText('Create an account');
  await wait(400);
  await driver.findElement(By.css('button[type=submit]')).click();
  await until(async () =>
    (await driver.findElements(By.css('textarea[aria-label="Write your reflection"]'))).length === 1,
  );

  // --- the artifact holds the middle -----------------------------------
  const geometry = await driver.executeScript(`
    const artifact = document.querySelector('[class*=artifactHead]')?.closest('div');
    const helper = document.querySelector('aside[aria-label="Reflection chat"]');
    return {
      artifact: artifact ? Math.round(artifact.getBoundingClientRect().width) : -1,
      helper: helper ? Math.round(helper.getBoundingClientRect().width) : -1,
    };
  `);
  check(
    'the C.H.A.T. is the wider column, the chat is the helper',
    geometry.artifact > geometry.helper,
    `artifact ${geometry.artifact}px vs chat ${geometry.helper}px`,
  );

  // --- nothing before something is written ------------------------------
  check(
    'no section fields before anything is written',
    (await fieldArea('Context')) === null,
  );
  await shoot('reflect-1280-empty');

  // --- write ------------------------------------------------------------
  await driver
    .findElement(By.css('textarea[aria-label="Write your reflection"]'))
    .sendKeys('Romans 8:28 met me this week and I could not see how any of it works together.');
  await driver.findElement(By.css('form button[type=submit]')).click();
  await until(async () => (await fieldArea('Context')) !== null);
  check('the four sections appear once there is something to shape', true);

  const application = await fieldArea('Application');
  await application.sendKeys(SENTENCE);
  await wait(300);
  check('the sentence is in the section before any button is pressed',
    (await writingOnScreen()).includes(SENTENCE));

  // --- every control, one at a time -------------------------------------
  const controls = [
    'Explain this passage',
    'Polish',
    'Shorten',
    'Summarize',
    'Suggest from conversation',
    'Save',
    'Share',
    'Full C.H.A.T.',
  ];

  for (const label of controls) {
    const found = await clickByText(label);
    if (!found) {
      check(`«${label}» is on the page`, false, 'not found');
      continue;
    }
    await wait(1300);
    // Sheets are modal; close whatever opened before reading the page back.
    if ((await driver.findElements(By.css('[role=dialog]'))).length > 0) {
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await wait(500);
    }
    check(`writing survives «${label}»`, (await writingOnScreen()).includes(SENTENCE));
  }

  // --- and a saved section against the control that used to delete it ----
  await until(async () => (await saveStateText()) === 'Saved', 6000);
  await driver.navigate().refresh();
  await until(async () => (await fieldArea('Application')) !== null);
  check('the saved section survived a reload',
    (await writingOnScreen()).includes(SENTENCE));

  await clickByText('Suggest from conversation');
  await wait(1500);
  check('a SAVED section survives «Suggest from conversation»',
    (await writingOnScreen()).includes(SENTENCE));

  // --- the save state is visible ----------------------------------------
  const heart = await fieldArea('Heart');
  await heart.sendKeys('It met me on a week I could not see the good.');
  await wait(300);
  const unsaved = await saveStateText();
  check('typing shows an unsaved state', /unsaved/i.test(unsaved), unsaved);
  await until(async () => /^Saved$/i.test(await saveStateText()), 6000);
  check('and it settles to Saved on its own', /^Saved$/i.test(await saveStateText()));

  // --- title and Scripture reference ------------------------------------
  const title = await driver.findElement(By.css('input[aria-label="Reflection title"]'));
  await title.clear();
  await title.sendKeys('The week I could not see it');
  await title.sendKeys(Key.ENTER);
  await wait(900);
  const reference = await driver.findElement(By.css('input[aria-label="Scripture reference"]'));
  await reference.clear();
  await reference.sendKeys('Romans 8:28');
  await reference.sendKeys(Key.ENTER);
  await wait(900);

  await driver.navigate().refresh();
  await until(async () => (await fieldArea('Heart')) !== null);
  const titleValue = await driver
    .findElement(By.css('input[aria-label="Reflection title"]'))
    .getAttribute('value');
  const referenceValue = await driver
    .findElement(By.css('input[aria-label="Scripture reference"]'))
    .getAttribute('value');
  check('the title can be set and survives a reload',
    titleValue === 'The week I could not see it', titleValue);
  check('the Scripture reference can be set and survives a reload',
    referenceValue === 'Romans 8:28', referenceValue);

  /*
   * Suggest title — an assist, and only an assist.
   *
   * It must produce something drawn from the writing, leave the existing title
   * alone when declined, stick across a reload when accepted, and never take
   * the field away from the person typing in it.
   */
  const titleBefore = await driver
    .findElement(By.css('input[aria-label="Reflection title"]'))
    .getAttribute('value');

  await clickByText('Suggest title');
  await until(async () => (await driver.findElements(By.css('[role=dialog]'))).length === 1, 10000);
  await wait(700);
  const suggestionSheet = await driver.findElement(By.css('[role=dialog]')).getText();
  const options = await driver.findElements(By.css('input[name=title-suggestion]'));
  check('Suggest title offers candidates to choose from', options.length > 0, `${options.length}`);
  check('and the candidates are drawn from what was written',
    /Romans 8:28/.test(suggestionSheet), suggestionSheet.split('\n').slice(2, 5).join(' | '));
  check('it says plainly that nothing is used until it is chosen',
    /until you choose it/i.test(suggestionSheet));
  await shoot('reflect-1280-suggest-title');

  // Declining must leave the author's own title exactly as it was.
  await clickByText('Keep my title');
  await wait(900);
  const titleAfterDecline = await driver
    .findElement(By.css('input[aria-label="Reflection title"]'))
    .getAttribute('value');
  check('declining leaves the existing title untouched',
    titleAfterDecline === titleBefore, `${titleBefore} → ${titleAfterDecline}`);

  // Accepting: pick a candidate deliberately, so choosing is what decides it.
  await clickByText('Suggest title');
  await until(async () => (await driver.findElements(By.css('[role=dialog]'))).length === 1, 10000);
  await wait(700);
  const choices = await driver.findElements(By.css('input[name=title-suggestion]'));
  await driver.executeScript('arguments[0].click()', choices[choices.length > 1 ? 1 : 0]);
  await wait(300);
  const chosenValue = await driver
    .findElement(By.css('input[aria-label="Title to use"]'))
    .getAttribute('value');
  await clickByText('Use this title');
  await wait(1500);

  await driver.navigate().refresh();
  await until(async () => (await fieldArea('Heart')) !== null, 10000);
  const titleAfterAccept = await driver
    .findElement(By.css('input[aria-label="Reflection title"]'))
    .getAttribute('value');
  check('accepting a suggestion sets the title, and it survives a reload',
    titleAfterAccept === chosenValue, `${chosenValue} → ${titleAfterAccept}`);
  check('and the accepted title is inside the format limit',
    titleAfterAccept.length > 0 && titleAfterAccept.length <= 100,
    `${titleAfterAccept.length} chars`);

  // The field is still the author's to type in directly.
  const titleField = await driver.findElement(By.css('input[aria-label="Reflection title"]'));
  await titleField.clear();
  await titleField.sendKeys('The week I could not see it');
  await titleField.sendKeys(Key.ENTER);
  await wait(1200);
  check('the title is still freely editable by hand',
    (await driver
      .findElement(By.css('input[aria-label="Reflection title"]'))
      .getAttribute('value')) === 'The week I could not see it');

  // --- discussing a section in the chat ---------------------------------
  const before = (await driver.findElements(By.css('[class*=messages] li'))).length;
  for (const button of await driver.findElements(By.css('[class*=discussButton]'))) {
    if (await button.isEnabled()) {
      await driver.executeScript('arguments[0].click()', button);
      break;
    }
  }
  await wait(1500);
  const after = (await driver.findElements(By.css('[class*=messages] li'))).length;
  const banner = (await driver.findElements(By.css('[class*=discussingBanner]'))).length;
  check('a section can be sent into the chat to discuss', after > before, `${before} → ${after}`);
  check('and the chat says which section is being worked on', banner === 1);
  await shoot('reflect-1280-artifact');

  /*
   * Provenance survives being edited.
   *
   * Accepting a suggestion and then changing a word must not turn the badge
   * into "Your words" — that would be the interface making a claim about
   * authorship that nobody made.
   */
  await clickByText('Suggest from conversation');
  await wait(1500);
  const applied = await clickByText('Use this in');
  await wait(1500);
  if (!applied) {
    check('an extraction can be accepted into a section', false, 'no apply control');
  } else {
    const badgeAfterApply = await driver.executeScript(
      `return [...document.querySelectorAll('[class*=badge]')].map((b) => b.textContent).join('|')`,
    );
    check('accepted wording is badged as the model’s help',
      /AI assisted|AI drafted/i.test(badgeAfterApply), badgeAfterApply);

    const context = await fieldArea('Context');
    await context.sendKeys(' And one word of my own.');
    await until(async () => /^Saved$/i.test(await saveStateText()), 8000);
    const badgeAfterEdit = await driver.executeScript(
      `return [...document.querySelectorAll('[class*=badge]')].map((b) => b.textContent).join('|')`,
    );
    check('and editing it does not quietly re-attribute it to the author',
      /AI assisted/i.test(badgeAfterEdit), badgeAfterEdit);
  }

  // --- share ------------------------------------------------------------
  await clickByText('Share');
  await until(async () => (await driver.findElements(By.css('[role=dialog]'))).length === 1);
  await wait(700); // let the sheet finish arriving before reading it back
  const sheet = await driver.findElement(By.css('[role=dialog]')).getText();
  check('the share sheet offers the three destinations',
    /Only me/i.test(sheet) && /Public/i.test(sheet) && /community/i.test(sheet));
  check('and shows Community as unavailable rather than faking it',
    /not available yet/i.test(sheet));
  const communityDisabled = await driver.executeScript(
    'return document.querySelector(\'input[value="community"]\')?.disabled === true',
  );
  check('the Community option cannot be chosen', communityDisabled === true);

  // Publishing an incomplete C.H.A.T. must fail with numbers, not "invalid".
  await driver.findElement(By.css('input[value="public"]')).click();
  await clickByText('Share publicly');
  await wait(1500);
  const refusal = await driver.findElement(By.css('[role=dialog]')).getText();
  check('a refused share names the fields at fault',
    /Still to write/i.test(refusal) && /Testimony/i.test(refusal), refusal.split('\n').slice(-4).join(' | '));
  check('and gives the numbers, not just "invalid"',
    /\d+ characters/i.test(refusal) || /renders to \d+ page/i.test(refusal));
  await shoot('reflect-1280-share');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await wait(500);

  // --- format switch ----------------------------------------------------
  await clickByText('Full C.H.A.T.');
  await until(async () => (await driver.findElements(By.css('[role=dialog]'))).length === 1);
  await wait(700);
  const formatSheet = await driver.findElement(By.css('[role=dialog]')).getText();
  check('the format sheet explains both formats before either is chosen',
    /Full C\.H\.A\.T\./.test(formatSheet) &&
      /Condensed C\.H\.A\.T\./.test(formatSheet) &&
      /Verse · Reflection/.test(formatSheet));
  check('and never calls Condensed incomplete',
    !/incomplete|simplified|partial/i.test(formatSheet));
  await shoot('reflect-1280-format');

  await clickByText('Change to Condensed');
  await wait(1800);
  await driver.navigate().refresh();
  await until(async () => (await fieldArea('Reflection')) !== null, 10000);
  const condensedBody = await writingOnScreen();
  check('the format switch persists across a reload',
    /Condensed C\.H\.A\.T\./.test(condensedBody));
  check('the Condensed form shows verse and reflection',
    (await fieldArea('Verse')) !== null && (await fieldArea('Reflection')) !== null);
  check('and no empty C/H/A/T fields beside them',
    (await fieldArea('Context')) === null && (await fieldArea('Testimony')) === null);
  check('the Full draft is preserved, not discarded',
    condensedBody.includes(SENTENCE) || (await driver.executeScript(`
      return fetch('/api/conversations/' + new URLSearchParams(location.search).get('c'),
        { credentials: 'include' }).then(r => r.json()).then(d => d.sections.application.content);
    `)) === SENTENCE);

  // Back again, and the Condensed draft is still there too.
  await clickByText('Condensed C.H.A.T.');
  await until(async () => (await driver.findElements(By.css('[role=dialog]'))).length === 1);
  await wait(700);
  await clickByText('Change to Full');
  await wait(1800);
  check('changing back restores the four sections',
    (await fieldArea('Context')) !== null && (await writingOnScreen()).includes(SENTENCE));

  // --- 390px ------------------------------------------------------------
  await driver.manage().window().setRect({ width: 390, height: 844 });
  await wait(900);
  const helperInline = await driver.findElements(By.css('aside[aria-label="Reflection chat"]'));
  check('the chat is not inline under 900px', helperInline.length === 0);
  await shoot('reflect-390-artifact');
  await clickByText('Chat');
  await wait(800);
  check('a Chat button opens it as a drawer',
    (await driver.findElements(By.css('[role=dialog]'))).length === 1);
  await shoot('reflect-390-chat');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await wait(500);
  await driver.manage().window().setRect({ width: 1280, height: 900 });
  await wait(700);

  // --- delete -----------------------------------------------------------
  const deleteButton = await driver.findElement(
    By.css('button[aria-label="Delete this reflection"]'),
  );
  await deleteButton.click();
  await until(async () => (await driver.findElements(By.css('[role=dialog]'))).length === 1);
  await wait(700);
  const confirm = await driver.findElement(By.css('[role=dialog]')).getText();
  check('deleting asks first, and says what goes', /cannot be undone/i.test(confirm));
  await clickByText('Delete permanently');
  await wait(1500);
  await driver.navigate().refresh();
  await wait(1500);
  const afterDelete = await writingOnScreen();
  check('the reflection is gone after a reload', !afterDelete.includes(SENTENCE));
  const listRows = await driver.findElements(By.css('[class*=listItem]'));
  check('and it is gone from the history', listRows.length === 0, `${listRows.length} rows`);

  // --- console ----------------------------------------------------------
  const severe = (await driver.manage().logs().get('browser')).filter(
    (entry) =>
      entry.level.name === 'SEVERE' &&
      !/favicon/.test(entry.message) &&
      !/auth\/me/.test(entry.message) &&
      !/\/publish/.test(entry.message),
  );
  check('no severe console errors', severe.length === 0, severe.map((e) => e.message).join(' | '));

  const failed = results.filter((r) => !r.passed);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await driver.quit();
}
