/*
 * Does anything on Reflect destroy what the author wrote?
 *
 * The owner reported that buttons with no visible effect were also clearing
 * work in progress. This script does not reason about that — it types a
 * sentence into a section, presses every control on the page one at a time,
 * and reads the sentence back after each press. A control that loses it fails
 * here by name, so the defect is named rather than guessed at.
 */
import { Builder, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

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

/** Everything the author's writing might be sitting in, as text. */
async function writingOnScreen() {
  return driver.executeScript(`
    const areas = [...document.querySelectorAll('textarea')].map((t) => t.value);
    return areas.join('\\u0000') + '\\u0000' + document.body.innerText;
  `);
}

async function clickByText(label) {
  for (const button of await driver.findElements(By.css('button'))) {
    const text = (await button.getText()).trim();
    if (text === label || text.startsWith(label)) {
      await button.click();
      return true;
    }
  }
  return false;
}

try {
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

  // Something written, so the C.H.A.T. exists at all.
  await driver
    .findElement(By.css('textarea[aria-label="Write your reflection"]'))
    .sendKeys('Romans 8:28 met me this week and I could not see how any of it works together.');
  await driver.findElement(By.css('form button[type=submit]')).click();
  await until(async () => (await driver.findElements(By.css('[class*=cardToggle]'))).length === 4);

  // Open the Application card and write, without saving.
  const cards = await driver.findElements(By.css('[class*=cardToggle]'));
  await cards[2].click();
  await wait(400);
  const area = await driver.findElement(By.css('[class*=cardBody] textarea'));
  await area.sendKeys(SENTENCE);
  await wait(300);
  check('the sentence is in the section before any button is pressed',
    (await writingOnScreen()).includes(SENTENCE));

  const controls = [
    'Explain this passage',
    'Polish',
    'Shorten',
    'Summarize',
    'Review C.H.A.T.',
    'Extract from conversation',
    'Publish',
  ];

  for (const label of controls) {
    const found = await clickByText(label);
    if (!found) {
      check(`«${label}» is on the page`, false, 'not found');
      continue;
    }
    await wait(1200);
    const survives = (await writingOnScreen()).includes(SENTENCE);
    check(`unsaved writing survives «${label}»`, survives);
    if (!survives) break; // once it is gone there is nothing left to test with
  }

  // And a saved section against the one control that rewrites sections.
  await driver.navigate().refresh();
  await until(async () => (await driver.findElements(By.css('[class*=cardToggle]'))).length === 4);
  const saved = 'My own words, saved deliberately, in Testimony.';
  const again = await driver.findElements(By.css('[class*=cardToggle]'));
  await again[3].click();
  await wait(400);
  await driver.findElement(By.css('[class*=cardBody] textarea')).sendKeys(saved);
  await clickByText('Save');
  await wait(1000);
  check('a saved section is on screen', (await writingOnScreen()).includes(saved));
  await clickByText('Extract from conversation');
  await wait(1500);
  check('a SAVED section survives «Extract from conversation»',
    (await writingOnScreen()).includes(saved));

  const failed = results.filter((r) => !r.passed);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await driver.quit();
}
