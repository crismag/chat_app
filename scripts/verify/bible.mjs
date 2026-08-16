/*
 * The passage card on Reflect, driven in a real browser.
 *
 * It asserts on structure and behaviour, never on wording, so it keeps passing
 * as the copy is revised. What it will not let past:
 *
 *   • the card is ABOVE the four sections, not below or beside them
 *   • the selected translation is the one whose id is 111, not one whose label
 *     merely starts with "NIV"
 *   • the passage is a blockquote and not a field anyone can type into
 *   • the attribution is on screen
 *   • a failed lookup leaves the previous passage and the draft alone
 *
 * With no key on the API it takes its other branch and checks the card says it
 * is not configured WITHOUT saying which way it is not configured — the path
 * that must never leak.
 */
import { Builder, By, Key, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const WEB = 'http://localhost:5173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function shot(driver, name) {
  await driver.executeScript('window.scrollTo(0, 0)');
  await wait(400);
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
}

async function sizeTo(driver, width, height) {
  await driver.manage().window().setRect({ width, height });
  await wait(500);
}

/*
 * Click a button by its visible text.
 *
 * Scrolled into view and clicked through the DOM rather than by pointer: the
 * page has a sticky header, and a button that is merely *behind* it fails a
 * native click with `ElementNotInteractable` — which reads like a broken
 * control and is really a broken test.
 */
async function clickButton(driver, text) {
  const clicked = await driver.executeScript(
    `const button = Array.from(document.querySelectorAll('button'))
       .find((node) => node.textContent.includes(arguments[0]) && !node.disabled);
     if (!button) return false;
     button.scrollIntoView({ block: 'center' });
     button.click();
     return true;`,
    text,
  );
  if (!clicked) throw new Error(`no enabled button matching “${text}”`);
  await wait(400);
}

/** Type into a field, replacing whatever is there, the way a person would. */
async function typeInto(driver, selector, value) {
  const field = await driver.findElement(By.css(selector));
  await driver.executeScript('arguments[0].scrollIntoView({ block: "center" })', field);
  await field.sendKeys(Key.chord(Key.CONTROL, 'a'), value);
  await wait(200);
}

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,1000'),
  )
  .build();

try {
  /* --- an account, so Reflect has something to show --------------------- */

  await driver.get(`${WEB}/login`);
  await wait(1500);
  await driver.findElement(By.css('#email')).sendKeys(`bible${Date.now()}@example.com`);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).includes('Create an account')) {
      await button.click();
      break;
    }
  }
  await wait(400);
  await driver.findElement(By.css('button[type=submit]')).click();
  await wait(2500);

  /* The Reflect page is the application's root route. */
  await driver.get(`${WEB}/`);
  await wait(2500);

  /*
   * A reflection has to exist before a passage can be attached to one.
   *
   * The application creates it on the first message rather than on page load —
   * an empty reflection nobody wrote is not a reflection — so the check starts
   * by writing something, exactly as a person would.
   */
  const composer = await driver.findElement(By.css('textarea[aria-label="Write your reflection"]'));
  await composer.sendKeys('Starting a reflection so the passage has somewhere to live.');
  await wait(400);
  await driver.findElement(By.css('button[aria-label="Send"]')).click();
  await wait(4000);

  /*
   * The AI disclosure appears on the first message and sits over the page.
   * Accepted here so the screenshots show the passage card rather than a
   * dialog — this check is not about that dialog, and a modal in every frame
   * would hide the thing being verified.
   */
  await driver.executeScript(`
    const accept = Array.from(document.querySelectorAll('button'))
      .find((node) => node.textContent.includes('I understand'));
    if (accept) accept.click();
  `);
  await wait(1200);

  /* --- is lookup configured on this server? ----------------------------- */

  const configured = await driver.executeScript(
    'return fetch("/api/bible/status").then((r) => r.json()).then((b) => b.available)',
  );
  console.log(`\nBible lookup ${configured ? 'is' : 'is NOT'} configured on this API\n`);

  const card = await driver.wait(until.elementLocated(By.css('section[aria-labelledby]')), 8000);

  if (!configured) {
    const text = await card.getText();
    check('the card says lookup is not configured', /not configured/i.test(text));
    /* And says nothing about WHICH way it is not configured. */
    check(
      'it does not reveal whether the key is absent, malformed or rejected',
      !/(missing|invalid|rejected|malformed|401|403|key)/i.test(text),
      'the difference is useful to an attacker and useless to a reader',
    );
    await shot(driver, 'bible-1280-unconfigured');
    console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  /* --- the card sits above the four sections ---------------------------- */

  const cardTop = (await card.getRect()).y;
  const sectionTops = await driver.executeScript(`
    return Array.from(document.querySelectorAll('textarea, [data-field]'))
      .map((node) => node.getBoundingClientRect().top + window.scrollY)
      .filter((top) => top > 0);
  `);
  check(
    'the passage card is above the writing',
    sectionTops.length > 0 && cardTop < Math.min(...sectionTops),
    `card at ${Math.round(cardTop)}, first field at ${Math.round(Math.min(...sectionTops))}`,
  );

  /* --- the catalog, and the translation that is selected ---------------- */

  await clickButton(driver, (await card.getText()).includes('Change passage') ? 'Change passage' : 'Choose a passage');
  await wait(800);

  const options = await driver.findElements(By.css('[role=option]'));
  check('the catalog loaded', options.length > 5, `${options.length} translations`);

  const selectedName = await driver.executeScript(`
    const chosen = document.querySelector('[role=option][aria-selected=true]');
    return chosen ? chosen.textContent : null;
  `);
  /*
   * The label reads "NIV", but what is being checked is that the entry selected
   * is the New International Version and not the Reader's Version or the
   * Anglicised edition — the two a string match on "NIV" would happily pick.
   */
  check(
    'the default selection is the New International Version',
    /New International Version/.test(selectedName ?? '') &&
      !/Reader/.test(selectedName ?? '') &&
      !/Anglicized|Anglicised/.test(selectedName ?? ''),
    (selectedName ?? 'nothing selected').trim().slice(0, 60),
  );

  /* --- search by name and by abbreviation ------------------------------- */

  const search = await driver.findElement(By.css('[role=combobox]'));
  await search.sendKeys('berean');
  await wait(400);
  check(
    'searching by name narrows the list',
    (await driver.findElements(By.css('[role=option]'))).length === 1,
  );
  await search.sendKeys(Key.chord(Key.CONTROL, 'a'), 'bsb');
  await wait(400);
  check(
    'searching by abbreviation finds the same one',
    (await driver.findElements(By.css('[role=option]'))).length === 1,
  );
  await search.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE);
  await wait(300);

  /* --- look a passage up ------------------------------------------------ */

  await typeInto(driver, 'input[placeholder="John 3:16-18"]', 'John 3:16–18');
  await clickButton(driver, 'Load passage');
  await wait(3000);

  const quote = await driver.findElements(By.css('blockquote'));
  check('the passage rendered', quote.length === 1);
  const passageText = quote.length ? await quote[0].getText() : '';
  check('it is the real verse', /For God so loved the world/i.test(passageText), passageText.slice(0, 50) + '…');
  check(
    'it is not an editable field',
    quote.length > 0 && (await quote[0].getAttribute('contenteditable')) === null,
    'a blockquote, not a textarea',
  );

  const cardText = await card.getText();
  check('the attribution is on screen', /Biblica/i.test(cardText), 'the publisher notice');
  check('the translation is shown beside the reference', /NIV/.test(cardText));
  check('the en dash was accepted', /John 3:16-18/.test(cardText), 'normalised to a hyphen');

  await shot(driver, 'bible-1280-passage');

  /* --- write something, then change translation ------------------------- */

  await driver.executeScript(`
    const field = document.querySelector('textarea');
    if (field) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, 'Written before the translation changed.');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await wait(600);

  await clickButton(driver, 'Change passage');
  await wait(600);
  await driver.executeScript(`
    const option = Array.from(document.querySelectorAll('[role=option]'))
      .find((node) => node.textContent.includes('Berean Standard Bible'));
    if (option) option.click();
  `);
  await wait(300);
  await clickButton(driver, 'Load passage');
  await wait(3000);

  const afterSwap = await card.getText();
  check(
    'changing translation reloads the same reference',
    /John 3:16-18/.test(afterSwap) && /BSB/.test(afterSwap),
    'same passage, different Bible',
  );
  const draftAfterSwap = await driver.executeScript(
    'const f = document.querySelector("textarea"); return f ? f.value : "";',
  );
  check(
    'the draft survived the change',
    draftAfterSwap.includes('Written before the translation changed'),
  );
  await shot(driver, 'bible-1280-changed');

  /* --- a failed lookup must not take the passage with it ---------------- */

  const before = await driver.findElement(By.css('blockquote')).getText();
  await clickButton(driver, 'Change passage');
  await wait(600);
  await typeInto(driver, 'input[placeholder="John 3:16-18"]', 'John 99:1');
  await clickButton(driver, 'Load passage');
  await wait(2500);

  const alerts = await driver.findElements(By.css('[role=alert]'));
  check('a bad reference is reported', alerts.length > 0);
  if (alerts.length) {
    const message = await alerts[0].getText();
    check('the message says which book and how many chapters', /21 chapters/.test(message), message.slice(0, 70));
  }
  const after = await driver.findElement(By.css('blockquote')).getText();
  check('the previous passage is untouched', after === before, 'word for word');
  const draftAfterFailure = await driver.executeScript(
    'const f = document.querySelector("textarea"); return f ? f.value : "";',
  );
  check(
    'the draft is untouched',
    draftAfterFailure.includes('Written before the translation changed'),
  );
  await shot(driver, 'bible-1280-failed-lookup');

  /* --- reload: the same translation and the same words ------------------ */

  await driver.navigate().refresh();
  await wait(3500);
  const reloaded = await driver.findElement(By.css('section[aria-labelledby]')).getText();
  check(
    'reopening shows the translation it was written against',
    /BSB/.test(reloaded) && /John 3:16-18/.test(reloaded),
    'not re-rendered in whatever is selected today',
  );

  /* --- mobile ----------------------------------------------------------- */

  await sizeTo(driver, 390, 844);
  await wait(1200);
  const overflows = await driver.executeScript(
    'return document.documentElement.scrollWidth > window.innerWidth + 2;',
  );
  check('nothing overflows horizontally at 390px', !overflows);
  await shot(driver, 'bible-390-passage');

  /*
   * The console, minus two expected noises: the unauthenticated `/auth/me`
   * probe every page load makes before it knows who you are, and the 400 this
   * script deliberately provoked to prove a bad reference is refused. Filtering
   * them by URL rather than lowering the bar generally, so a real error still
   * fails the run.
   */
  const severe = (await driver.manage().logs().get('browser')).filter(
    (entry) =>
      entry.level.name === 'SEVERE' &&
      !/favicon/.test(entry.message) &&
      !/auth\/me/.test(entry.message) &&
      !/bible\/passages\?[^ ]*John%2099/.test(entry.message),
  );
  check('the console is clean', severe.length === 0, severe.map((e) => e.message).join('\n'));

  console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
} finally {
  await driver.quit();
}

process.exit(failures === 0 ? 0 : 1);
