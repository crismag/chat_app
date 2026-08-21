/*
 * What is the narrowest screen this page actually fits on, and what stops it?
 *
 * Measuring overflow by asking the browser for `innerWidth` turned out to be
 * useless: in mobile emulation Chrome *widens the layout viewport* when the
 * content demands it, so a page that needs 576px reports being 576px wide and
 * every element inside it then "fits". The overflow disappears into the
 * measurement.
 *
 * So this does not ask the browser how wide it is. It pins the document to a
 * width, lets the page lay out inside that, and then asks which elements stick
 * out of it. That is the actual question — "what needs more room than a phone
 * has" — and the answer is a list of culprits rather than a number.
 *
 *   node scripts/verify/narrowest.mjs [width] [path]
 */
import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const width = Number(process.argv[2] ?? 320);
const path = process.argv[3] ?? '/reflections';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Pin the document, and let everything inside it overflow visibly rather than
 * being absorbed by a wider viewport. `min-width: 0` is not applied here on
 * purpose — the point is to see what the page does, not to fix it in place.
 */
const PIN = `
  const style = document.createElement('style');
  style.id = 'narrowest-probe';
  style.textContent =
    'html { width: ' + ${width} + 'px !important; overflow-x: visible !important; }' +
    'body { width: ' + ${width} + 'px !important; }';
  document.head.appendChild(style);
`;

const FIND = `
  const limit = ${width};
  const rows = [];
  document.querySelectorAll('body *').forEach((el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    if (box.right <= limit + 1) return;
    /*
     * Only the shallowest offender in any branch: a wide element makes every
     * one of its children look wide, and a list of forty descendants of one
     * mistake is not a list of forty mistakes.
     */
    if (el.parentElement && el.parentElement.getBoundingClientRect().right > limit + 1) return;
    const style = getComputedStyle(el);
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').split(' ').slice(0, 2).join(' '),
      width: Math.round(box.width),
      right: Math.round(box.right),
      minWidth: style.minWidth,
      flex: style.flex,
      whiteSpace: style.whiteSpace,
      text: String(el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
    });
  });
  return JSON.stringify(rows.slice(0, 12));
`;

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(new chrome.Options().addArguments('--headless=new', '--no-sandbox'))
  .build();

try {
  await driver.get(`${WEB}${path}`);
  await wait(2000);

  /* A guest with one reflection: the page overflowed only once it had content. */
  await driver.executeScript(`
    const post = (p, b) => fetch(p, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const patch = (p, b) => fetch(p, { method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
    return (async () => {
      await post('/api/auth/guest', { creationSource: 'REFLECTION_CREATE' });
      const made = await post('/api/conversations', {
        title: 'Becoming intentional and consistent', scriptureReference: 'Luke 22:46' });
      await patch('/api/conversations/' + made.id + '/sections', { type: 'content',
        content: 'Luke 22:46 (NIV) — Why are you sleeping? he asked. Get up and pray so that you will not fall into temptation.' });
      await patch('/api/conversations/' + made.id + '/sections', { type: 'heart',
        content: 'I have slept through this more often than I have prayed through it.' });
      return 'seeded';
    })();
  `);

  /* Back through the router, so nothing about the page load is re-run. */
  await driver.executeScript(`document.querySelector('a[href="/"]')?.click()`);
  await wait(1000);
  await driver.executeScript(`document.querySelector('a[href="${path}"]')?.click()`);
  await wait(2500);

  await driver.executeScript(PIN);
  await wait(500);

  const found = JSON.parse(await driver.executeScript(FIND));
  console.log(`\n${path} pinned to ${width}px — ${found.length} element(s) stick out:\n`);
  for (const row of found) {
    console.log(`  ${row.width}px wide, ends at ${row.right}`);
    console.log(`    <${row.tag} class="${row.cls}">  "${row.text}"`);
    console.log(`    min-width: ${row.minWidth}   flex: ${row.flex}   white-space: ${row.whiteSpace}`);
  }
  if (found.length === 0) console.log('  nothing — the page fits.');
} finally {
  await driver.quit();
}
