/*
 * One screen, at every viewport that matters, with the numbers to prove it.
 *
 *   node scripts/verify/screen.mjs <path> <label> [--dark] [--safari] [--all]
 */
import { newDriver, capture, report, wait, emulateDark } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname;
const [, , path = '/reflections', label = 'now'] = process.argv;
const dark = process.argv.includes('--dark');
const safari = process.argv.includes('--safari');
const all = process.argv.includes('--all');

const VIEWPORTS = all
  ? [
      { name: '320', width: 320, height: 640 },
      { name: '360', width: 360, height: 800 },
      { name: '375', width: 375, height: 812 },
      { name: '390', width: 390, height: 844 },
      { name: '430', width: 430, height: 932 },
      { name: '844x390', width: 844, height: 390 },
    ]
  : [
      { name: '390', width: 390, height: 844 },
      { name: '360', width: 360, height: 800 },
    ];

const slug = path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

for (const viewport of VIEWPORTS) {
  const driver = await newDriver({ ...viewport, safari });
  try {
    await driver.get(WEB);
    await wait(1400);
    await seed(driver);
    /*
     * Reloaded rather than routed, so the session the seed created is the one
     * the application boots with — the auth context reads /auth/me on mount
     * and a router navigation would never ask again.
     *
     * Safe because the emulation is given at launch: it belongs to the browser
     * and a reload cannot drop it. Media emulation is re-applied because that
     * one is a CDP session setting.
     */
    await driver.get(`${WEB}${path}`);
    await wait(2200);
    if (dark) {
      await emulateDark(driver);
      await wait(400);
    }
    const name = `${label}-${slug}-${viewport.name}${dark ? '-dark' : ''}${safari ? '-safari' : ''}`;
    report(name, await capture(driver, { ...viewport, out: OUT, name, dark }));
  } catch (error) {
    console.log(`  ${viewport.name}: ${error.message}`);
  } finally {
    await driver.quit();
  }
}
