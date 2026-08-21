/*
 * The search contract, driven the way a person drives it.
 *
 * Each of these is a promise made in the specification, and each one is the
 * sort of promise that quietly stops being true: the address and the field
 * drift apart, or Back starts toggling instead of leaving.
 */
import { newDriver, wait } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const d = await newDriver({ width: 390, height: 844 });
const results = [];
const check = (what, pass, detail = '') =>
  results.push(`  ${pass ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);

const url = () => d.executeScript('return location.search');
const fieldValue = () =>
  d.executeScript(`const f = document.getElementById('reflections-search'); return f ? f.value : null`);
const searchOpen = () => d.executeScript(`return !!document.getElementById('reflections-search')`);
const focused = () => d.executeScript('return document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || ""');
const cards = () => d.executeScript(`return document.querySelectorAll('h3 a').length`);

try {
  await d.get(WEB);
  await wait(1400);
  await seed(d);

  /* 1. A URL carrying a query opens search active and populated. */
  await d.get(`${WEB}/reflections?q=mercy`);
  await wait(2400);
  check('a URL with a query opens search already active', await searchOpen());
  check('…with the field filled in from the address', (await fieldValue()) === 'mercy',
    `field is "${await fieldValue()}"`);
  const narrowed = await cards();
  check('…and the list is actually narrowed', narrowed > 0 && narrowed < 6, `${narrowed} shown`);

  /* 2. Clear empties query and address but leaves search open and focused. */
  await d.executeScript(`document.querySelector('[aria-label="Clear search"]').click()`);
  await wait(700);
  check('clear leaves search open', await searchOpen());
  check('clear empties the field', (await fieldValue()) === '');
  check('clear drops the query from the address', !(await url()).includes('q='), await url());
  check('clear keeps focus in the field', (await focused()) === 'reflections-search',
    `focus on "${await focused()}"`);

  /* 3. Typing puts it back, without pushing a history entry per keystroke. */
  const before = await d.executeScript('return history.length');
  await d.executeScript(`
    const f = document.getElementById('reflections-search');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (const text of ['m', 'me', 'mer', 'merc', 'mercy']) {
      set.call(f, text);
      f.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await wait(900);
  const after = await d.executeScript('return history.length');
  check('typing does not push a history entry per keystroke', after - before <= 1,
    `history grew by ${after - before}`);

  /* 4. Closing search restores the unfiltered list and returns focus. */
  await d.executeScript(`document.querySelector('[aria-label="Close search"]').click()`);
  await wait(900);
  check('closing search closes the field', !(await searchOpen()));
  check('closing search drops the query', !(await url()).includes('q='), await url());
  const restored = await cards();
  check('closing search restores the unfiltered list', restored > narrowed, `${restored} shown`);
  check('closing search returns focus to the search trigger',
    (await focused()) === 'Search reflections', `focus on "${await focused()}"`);

  /* 5. Back is not trapped: from a clean list it leaves the screen. */
  await d.navigate().back();
  await wait(1200);
  const left = await d.executeScript('return location.pathname');
  check('Back is not trapped toggling search', left !== '/reflections' || !(await searchOpen()),
    `landed on ${left}`);
} finally {
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.includes('FAIL')).length;
  console.log(`\n  ${results.length - failed}/${results.length} passed`);
  await d.quit();
}
