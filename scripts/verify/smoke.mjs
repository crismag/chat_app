/*
 * A smoke check that the app boots, authenticates and renders — run from this
 * repository, using this repository's own dependency.
 */
import { Builder, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

try {
  await driver.get('http://localhost:5173/login');
  await wait(2000);

  const email = `smoke${Date.now()}@example.com`;
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
  await wait(2500);

  console.log('  signed in at', (await driver.getCurrentUrl()).replace('http://localhost:5173', ''));
  writeFileSync(new URL('smoke.png', OUT), await driver.takeScreenshot(), 'base64');

  const severe = (await driver.manage().logs().get('browser')).filter(
    (entry) => entry.level.name === 'SEVERE' && !/favicon/.test(entry.message),
  );
  console.log('  console:', severe.length ? severe.map((e) => e.message).join('\n') : 'clean');
} finally {
  await driver.quit();
}
