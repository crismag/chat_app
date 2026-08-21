/* The four screens as they are now, at one verified viewport, for comparison. */
import { newDriver, capture, report, wait, emulateDark } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/before/', import.meta.url).pathname;
const label = process.argv[2] ?? 'before';
const dark = process.argv.includes('--dark');

const SCREENS = [
  { name: 'editor', href: '/' },
  { name: 'reflections', href: '/reflections' },
  { name: 'community', href: '/community' },
];

for (const screen of SCREENS) {
  const driver = await newDriver({ width: 390, height: 844 });
  try {
    await driver.get(`${WEB}${screen.href}`);
    await wait(1500);
    if (dark) await emulateDark(driver);
    const made = await seed(driver);
    /* Reload through the router so the seeded list is shown, keeping emulation. */
    await driver.executeScript(`document.querySelector('a[href="/community"]')?.click()`);
    await wait(900);
    await driver.executeScript(
      `document.querySelector('a[href=${JSON.stringify(screen.href)}]')?.click()`,
    );
    await wait(2500);
    const name = `${label}-${screen.name}-390${dark ? '-dark' : ''}`;
    report(name, await capture(driver, { width: 390, height: 844, out: OUT, name, dark }));
    if (screen.name === 'reflections' && made.complete) {
      await driver.executeScript(
        `document.querySelector('a[href="/reflections/${made.complete}"]')?.click()`,
      );
      await wait(2200);
      const v = `${label}-viewer-390${dark ? '-dark' : ''}`;
      report(v, await capture(driver, { width: 390, height: 844, out: OUT, name: v, dark }));
    }
  } catch (error) {
    console.log(`  ${screen.name}: ${error.message}`);
  } finally {
    await driver.quit();
  }
}
console.log(`\nout: scripts/verify/out/before/`);
