/*
 * Can every action be reached, with the floating button and the bar in the way?
 *
 * "It looks fine" is not an answer to this: the floating action sits over the
 * list at every scroll position, and whether the *last* card's controls can be
 * brought clear depends on padding nobody can see. So this scrolls to the end
 * and asks each control whether the action or the bar is on top of it.
 */
import { newDriver, wait } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const path = process.argv[2] ?? '/reflections';

const CHECK = `
  window.scrollTo(0, document.body.scrollHeight);
  return new Promise((resolve) => setTimeout(() => {
    const box = (el) => el && el.getBoundingClientRect();
    const fab = box(document.querySelector('a[href="/?new=1"]'));
    const nav = box(document.querySelector('nav[aria-label="Primary phone"]'));
    const overlaps = (a, b) =>
      a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    /* Everything somebody might need to press at the end of the list. */
    const targets = [
      ...document.querySelectorAll('[aria-label^="Actions for"], [aria-label^="More actions"]'),
    ].map((el) => ({ what: el.getAttribute('aria-label'), rect: box(el) }));
    const pager = document.querySelector('nav[aria-label*="ages"], [data-pager]');
    if (pager) targets.push({ what: 'pager', rect: box(pager) });
    const lastCard = [...document.querySelectorAll('li')].pop();
    if (lastCard) targets.push({ what: 'last card', rect: box(lastCard) });

    resolve(JSON.stringify({
      fab: fab ? { top: Math.round(fab.top), bottom: Math.round(fab.bottom) } : null,
      nav: nav ? { top: Math.round(nav.top) } : null,
      blocked: targets
        .filter((t) => overlaps(t.rect, fab) || overlaps(t.rect, nav))
        .map((t) => ({
          what: t.what,
          by: overlaps(t.rect, fab) ? 'the floating action' : 'the bottom bar',
          bottom: Math.round(t.rect.bottom),
        })),
      checked: targets.length,
    }));
  }, 700));
`;

for (const viewport of [
  { name: '390', width: 390, height: 844 },
  { name: '360', width: 360, height: 800 },
  { name: '320', width: 320, height: 640 },
]) {
  const driver = await newDriver(viewport);
  try {
    await driver.get(WEB);
    await wait(1400);
    await seed(driver);
    await driver.get(`${WEB}${path}`);
    await wait(2400);
    const r = JSON.parse(await driver.executeScript(CHECK));
    const verdict = r.blocked.length === 0 ? 'all reachable' : `${r.blocked.length} BLOCKED`;
    console.log(`  ${viewport.name}px — ${r.checked} controls checked — ${verdict}`);
    for (const b of r.blocked) console.log(`      ${b.what} is under ${b.by}`);
  } catch (error) {
    console.log(`  ${viewport.name}: ${error.message}`);
  } finally {
    await driver.quit();
  }
}
