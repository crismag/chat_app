/*
 * Reflect, driven end to end.
 *
 * The claims this script exists to test are the ones a unit test cannot make
 * honestly: that a person can register and write without meeting a title form,
 * that the four C.H.A.T. sections stay away until something has been written,
 * that the sidebar collapses and comes back, and that only one section card is
 * ever open. It ends by photographing the result at both widths, because the
 * point of the redesign is how it looks.
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

/** Wait for a condition rather than for a guess at how slow the machine is. */
async function until(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await wait(150);
  }
}

async function shoot(driver, name) {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
}

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

try {
  // --- register ---------------------------------------------------------
  await driver.get('http://localhost:5173/login');
  await until(async () => (await driver.findElements(By.css('#email'))).length === 1);
  const email = `reflect${Date.now()}@example.com`;
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
  await until(async () => (await driver.findElements(By.css('textarea[aria-label="Write your reflection"]'))).length === 1);
  check('registered and landed on Reflect', !/\/login/.test(await driver.getCurrentUrl()));

  // --- the header -------------------------------------------------------
  const body = () => driver.findElement(By.css('body')).getText();
  check('no API status in the header', !(await body()).includes('API connected'));
  /*
   * The address is still announced to a screen reader from inside the menu
   * trigger; what must not survive is the truncated email printed on screen.
   */
  const emailPainted = await driver.executeScript(
    `return [...document.querySelectorAll('header *')].some((el) => {
       if (el.children.length) return false;
       if (el.closest('.sr-only') || el.classList.contains('sr-only')) return false;
       return el.textContent.includes(arguments[0]);
     })`,
    email,
  );
  check('no email printed in the header', !emailPainted);

  const trigger = await driver.findElement(By.css('header button[aria-haspopup=menu]'));
  await trigger.click();
  await wait(300);
  const menuOpen = (await driver.findElements(By.css('[role=menu]'))).length === 1;
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await wait(300);
  const menuClosed = (await driver.findElements(By.css('[role=menu]'))).length === 0;
  const focusBack = await driver.executeScript(
    'return document.activeElement === arguments[0]',
    trigger,
  );
  check('profile menu opens, Escape closes, focus returns', menuOpen && menuClosed && focusBack);

  // --- the empty state, before anything is written ----------------------
  check(
    'empty state asks the question',
    (await body()).includes('What passage are you reflecting on today?'),
  );
  const cardsBefore = await driver.findElements(By.css('[class*=cardToggle]'));
  check('no section cards before writing', cardsBefore.length === 0, `${cardsBefore.length} found`);
  await shoot(driver, 'reflect-1280-empty');

  // --- writing, with no title form --------------------------------------
  const composer = await driver.findElement(By.css('textarea[aria-label="Write your reflection"]'));
  await composer.sendKeys(
    'Romans 8:28 keeps meeting me this week. I cannot see how any of this works together, and I want to say I trust it anyway.',
  );
  await wait(300);
  await driver.findElement(By.css('form button[type=submit]')).click();
  await until(async () => (await driver.findElements(By.css('[class*=cardToggle]'))).length === 4);

  const cardsAfter = await driver.findElements(By.css('[class*=cardToggle]'));
  check('four section cards appear after writing', cardsAfter.length === 4, `${cardsAfter.length} found`);
  check('the message is on screen', (await body()).includes('keeps meeting me this week'));
  check('progress is stated in words', /\d of 4 reflected/.test(await body()));

  // --- one card open at a time ------------------------------------------
  await cardsAfter[0].click();
  await wait(400);
  let open = await driver.findElements(By.css('[class*=cardToggle][aria-expanded=true]'));
  const firstOpened = open.length === 1;
  await (await driver.findElements(By.css('[class*=cardToggle]')))[2].click();
  await wait(400);
  open = await driver.findElements(By.css('[class*=cardToggle][aria-expanded=true]'));
  check(
    'only one section card is open at a time',
    firstOpened && open.length === 1,
    `${open.length} expanded after opening a second`,
  );

  // --- writing into a section, and the counter --------------------------
  const area = await driver.findElement(By.css('[class*=cardBody] textarea'));
  await area.sendKeys('I will pray before I react, and say the promise out loud when I cannot feel it.');
  await wait(300);
  const counter = await driver.findElements(By.css('[class*=counter]'));
  check('a live counter is shown while typing', counter.length > 0);
  for (const b of await driver.findElements(By.css('[class*=cardActions] button'))) {
    if ((await b.getText()) === 'Save') {
      await b.click();
      break;
    }
  }
  await until(async () => /1 of 4 reflected/.test(await body()));
  check('the saved section counts towards progress', /1 of 4 reflected/.test(await body()));
  await shoot(driver, 'reflect-1280-written');

  // --- the sidebar ------------------------------------------------------
  const collapseButton = await driver.findElement(
    By.css('button[aria-label="Collapse the reflections list"]'),
  );
  await collapseButton.click();
  await wait(500);
  const railWidth = await driver.executeScript(
    'const el = document.querySelector("aside[aria-label=Reflections]"); return el ? Math.round(el.getBoundingClientRect().width) : -1;',
  );
  const stored = await driver.executeScript(
    'return window.localStorage.getItem("chat.reflect.sidebar")',
  );
  check('the sidebar collapses to a rail', railWidth > 0 && railWidth <= 60, `${railWidth}px`);
  check('the preference is remembered', stored === 'collapsed', String(stored));
  await shoot(driver, 'reflect-1280-collapsed');

  await driver.navigate().refresh();
  await until(async () => (await driver.findElements(By.css('aside[aria-label=Reflections]'))).length === 1);
  await wait(500);
  const widthAfterReload = await driver.executeScript(
    'const el = document.querySelector("aside[aria-label=Reflections]"); return el ? Math.round(el.getBoundingClientRect().width) : -1;',
  );
  check('it is still collapsed after a reload', widthAfterReload <= 60, `${widthAfterReload}px`);

  await driver.findElement(By.css('button[aria-label="Expand the reflections list"]')).click();
  await wait(500);
  const expandedWidth = await driver.executeScript(
    'const el = document.querySelector("aside[aria-label=Reflections]"); return el ? Math.round(el.getBoundingClientRect().width) : -1;',
  );
  check('and expands again', expandedWidth > 180, `${expandedWidth}px`);

  // --- narrow: the companion is a drawer --------------------------------
  await driver.manage().window().setRect({ width: 390, height: 844 });
  await wait(900);
  const companionInline = await driver.findElements(By.css('aside[aria-label="C.H.A.T. companion"]'));
  const drawerButton = (await driver.findElements(By.css('button'))).length;
  let chatButton = null;
  for (const b of await driver.findElements(By.css('button'))) {
    if (/^C\.H\.A\.T\. \d\/4$/.test((await b.getText()).trim())) {
      chatButton = b;
      break;
    }
  }
  check('the companion is not inline under 900px', companionInline.length === 0);
  check('a C.H.A.T. n/4 button opens it instead', chatButton !== null, `${drawerButton} buttons`);
  await shoot(driver, 'reflect-390-thread');

  if (chatButton) {
    await chatButton.click();
    await wait(700);
    const dialog = await driver.findElements(By.css('[role=dialog]'));
    check('the drawer opens', dialog.length === 1);
    await shoot(driver, 'reflect-390-drawer');
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await wait(500);
    check(
      'Escape closes the drawer',
      (await driver.findElements(By.css('[role=dialog]'))).length === 0,
    );
  }

  /*
   * Dark is not a second stylesheet — it is the same tokens resolving
   * differently — so this is a photograph to look at rather than an assertion.
   */
  await driver.manage().window().setRect({ width: 1280, height: 900 });
  await wait(600);
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await wait(600);
  await shoot(driver, 'reflect-1280-dark');
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', { features: [] });

  // --- console ----------------------------------------------------------
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
