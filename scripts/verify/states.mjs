/*
 * The states a screenshot of a resting page never shows.
 *
 * A sheet that is wrong is wrong only while it is open, so the evidence has to
 * open it. Each state drives the interface the way a person would — pressing
 * the control rather than setting the state behind it — so what is captured is
 * what the control actually does.
 */
import { newDriver, capture, report, wait, emulateDark } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname;
const label = process.argv[2] ?? 'state';
const dark = process.argv.includes('--dark');

const press = (selector) => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'missing: ' + ${JSON.stringify(selector)};
  el.click();
  return 'ok';
`;

/** name → what to do once the screen is loaded. */
const STATES = {
  'reflections-search': [press('[aria-label="Search reflections"]')],
  'reflections-filters': [press('[aria-label^="Filters"]')],
  'reflections-view': [press('[aria-label="Menu"]')],
  'reflections-actions': [press('[aria-label^="Actions for"]')],
  'reflections-end': [`window.scrollTo(0, document.body.scrollHeight); return 'ok';`],
};

const viewport = { width: 390, height: 844 };

for (const [name, steps] of Object.entries(STATES)) {
  const driver = await newDriver(viewport);
  try {
    await driver.get(WEB);
    await wait(1400);
    await seed(driver);
    await driver.get(`${WEB}/reflections`);
    await wait(2300);
    if (dark) {
      await emulateDark(driver);
      await wait(300);
    }
    for (const step of steps) {
      const outcome = await driver.executeScript(step);
      if (outcome !== 'ok') console.log(`  ${name}: ${outcome}`);
      await wait(900);
    }
    const file = `${label}-${name}${dark ? '-dark' : ''}`;
    report(file, await capture(driver, { ...viewport, out: OUT, name: file, dark }));
  } catch (error) {
    console.log(`  ${name}: ${error.message}`);
  } finally {
    await driver.quit();
  }
}
