/*
 * Whether the four screens are one application.
 *
 * Each was built in its own session against its own screenshot, which is
 * exactly how four screens end up with three app-bar heights and two ideas of
 * where the account lives. These are the things that must match, measured
 * rather than looked at — a 2px difference in bar height is invisible one
 * screen at a time and obvious when you move between them.
 */
import { newDriver, wait } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const vp = { width: 390, height: 844 };

const PROBE = `
  const bar = document.querySelector('header');
  const nav = document.querySelector('nav[aria-label="Primary phone"]');
  const barBox = bar?.getBoundingClientRect();
  const navBox = nav?.getBoundingClientRect();
  const barStyle = bar ? getComputedStyle(bar) : null;
  const inner = bar?.querySelector('div');
  const innerStyle = inner ? getComputedStyle(inner) : null;

  /*
   * Only what is on screen. The desktop header is still in the document at
   * phone widths, hidden by CSS, and its buttons were what this measured —
   * so every screen reported the same wrong answer, which looked like
   * consistency.
   */
  const actions = [...(bar?.querySelectorAll('button') ?? [])].filter(
    (b) => b.getBoundingClientRect().width > 0,
  );
  const last = actions[actions.length - 1];

  const heading = document.querySelector('h1');
  return JSON.stringify({
    barHeight: barBox ? Math.round(barBox.height) : null,
    barPadLeft: innerStyle ? innerStyle.paddingLeft : null,
    headings: document.querySelectorAll('h1').length,
    headingText: heading?.textContent?.trim().slice(0, 26) ?? null,
    lastAction: last?.getAttribute('aria-label') ?? null,
    lastActionRight: last && barBox ? Math.round(barBox.right - last.getBoundingClientRect().right) : null,
    navHeight: navBox ? Math.round(navBox.height) : null,
    /* The gap the page reserves under itself, so nothing sits behind the bar. */
    bodyPadBottom: getComputedStyle(document.querySelector('main') ?? document.body).paddingBottom,
    serifTitle: (() => {
      const t = document.querySelector('h1, h3');
      return t ? getComputedStyle(t).fontFamily.split(',')[0].replace(/["']/g, '') : null;
    })(),
  });
`;

const d = await newDriver(vp);
const rows = [];
try {
  await d.get(WEB);
  await wait(1600);
  const made = await seed(d);

  for (const [label, path] of [
    ['editor', '/'],
    ['reflections', '/reflections'],
    ['viewer', `/reflections/${made.complete}`],
    ['community', '/community'],
  ]) {
    await d.get(`${WEB}${path}`);
    await wait(2400);
    rows.push([label, JSON.parse(await d.executeScript(PROBE))]);
  }
} finally {
  await d.quit();
}

const col = (key) => rows.map(([, r]) => r[key]);
const same = (key) => new Set(col(key).map(String)).size === 1;

console.log('\n  screen        bar  padL   nav  h1  last action        rightGap');
for (const [label, r] of rows) {
  console.log(
    `  ${label.padEnd(12)} ${String(r.barHeight).padStart(4)} ${String(r.barPadLeft).padStart(5)} ` +
      `${String(r.navHeight).padStart(5)} ${String(r.headings).padStart(3)}  ` +
      `${String(r.lastAction).padEnd(18)} ${String(r.lastActionRight).padStart(4)}`,
  );
}

console.log('\n  consistency');
for (const [what, key] of [
  ['app-bar height', 'barHeight'],
  ['app-bar gutter', 'barPadLeft'],
  ['bottom-nav height', 'navHeight'],
  ['last bar action (account menu)', 'lastAction'],
  ['its distance from the edge', 'lastActionRight'],
  ['bottom clearance reserved', 'bodyPadBottom'],
]) {
  console.log(`    ${same(key) ? 'ok  ' : 'DIFF'}  ${what.padEnd(32)} ${[...new Set(col(key).map(String))].join(' | ')}`);
}
const oneHeading = col('headings').every((n) => n === 1);
console.log(`    ${oneHeading ? 'ok  ' : 'DIFF'}  exactly one h1 per screen        ${col('headings').join(' ')}`);
