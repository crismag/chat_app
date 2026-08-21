/*
 * The screens at 200% text.
 *
 * Not page zoom — that scales everything together and hides exactly the bugs
 * worth finding. Browser text scaling enlarges type while the viewport stays
 * the size it was, so a layout built on fixed pixel boxes starts clipping
 * words and overlapping controls while a zoomed one looks fine. This
 * application sizes its type in rem, so doubling the root font size is what
 * that setting actually does.
 *
 *   node scripts/verify/text-scaling.mjs [scale]
 */
import { newDriver, capture, report, wait } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname;
const scale = Number(process.argv[2] ?? 2);
const vp = { width: 390, height: 844 };

const SCALE = `
  const style = document.createElement('style');
  style.id = 'text-scaling';
  style.textContent = 'html { font-size: ' + (16 * ${scale}) + 'px !important; }';
  document.head.appendChild(style);
  return getComputedStyle(document.documentElement).fontSize;
`;

const AUDIT = `
  const MIN = 44;
  const problems = { clipped: [], overlapping: [], small: [], overflow: 0 };
  problems.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;

  const name = (el) =>
    (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName)
      .trim().replace(/\\s+/g, ' ').slice(0, 38);

  /*
   * Clipped text that matters.
   *
   * A preview deliberately clamped to two lines is not a defect — that is the
   * card summarising. What is a defect is a heading, a label or a control
   * whose own box cuts its words off, so only single-line-clamped or
   * hidden-overflow elements that are NOT line-clamped are counted.
   */
  for (const el of document.querySelectorAll('h1, h2, h3, button, a, label, legend, [role=tab]')) {
    const style = getComputedStyle(el);
    const clamped = style.webkitLineClamp && style.webkitLineClamp !== 'none';
    if (clamped) continue;
    const hidden = style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden';
    if (!hidden) continue;
    /*
     * A visually-hidden label is a 1px box with hidden overflow by design —
     * that is how it stays available to a screen reader without occupying the
     * page. It is always "clipped" and never a defect.
     */
    const box0 = el.getBoundingClientRect();
    if (box0.width <= 2 || box0.height <= 2) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
      problems.clipped.push({ name: name(el), tag: el.tagName.toLowerCase() });
    }
  }

  /*
   * While a modal sheet is open, the page behind it is not in play.
   *
   * Its scrim covers the viewport and its focus trap keeps the keyboard
   * inside, so comparing the sheet's buttons against the page underneath
   * reports the scrim overlapping everything — which is the scrim doing its
   * job. When a dialog is open, only the dialog is measured.
   */
  const modal = document.querySelector('[role=dialog][aria-modal=true]');
  const scope = modal ?? document;

  /* Controls: still a thumb, and still not on top of one another. */
  const controls = [...scope.querySelectorAll('button, a[href], input, select, textarea, [role=tab]')]
    .filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      /*
       * A visually-hidden radio inside its own label is not the target — the
       * label is, and it wraps the input. Counting the 1px input reported the
       * filters sheet as thirteen undersized controls overlapping five
       * others, when what it actually has is thirteen chips.
       */
      if (box.width <= 2 || box.height <= 2) return false;
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    });

  /*
   * A card's title is a stretched link: a small anchor whose ::after covers
   * the whole card. Measuring the anchor calls a full-card target 36px.
   */
  const hitArea = (el) => {
    const after = getComputedStyle(el, '::after');
    if (after.content !== 'none' && after.position === 'absolute') {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (getComputedStyle(node).position !== 'static') return node.getBoundingClientRect();
      }
    }
    return el.getBoundingClientRect();
  };

  for (const el of controls) {
    const box = hitArea(el);
    if (box.height < MIN - 0.5) problems.small.push({ name: name(el), h: Math.round(box.height) });
  }

  /*
   * A fixed bar is a layer, not a sibling.
   *
   * Content scrolls underneath the app bar and the bottom navigation by
   * design; at any given scroll position something is always beneath them.
   * Counting that as two controls overlapping reports the layout working as
   * intended, and buries the real overlaps. Whether an action can be brought
   * clear of those bars is a different question, which clearance.mjs asks.
   */
  const layered = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  };

  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      if (layered(controls[i]) !== layered(controls[j])) continue;
      const a = controls[i].getBoundingClientRect();
      const b = controls[j].getBoundingClientRect();
      const over = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      if (over) problems.overlapping.push({ a: name(controls[i]), b: name(controls[j]) });
    }
  }

  /* What is actually sticking out, so the number has a cause attached. */
  problems.widest = [];
  const limit = document.documentElement.clientWidth;
  document.querySelectorAll('body *').forEach((el) => {
    const box = el.getBoundingClientRect();
    if (box.right <= limit + 1 || box.width === 0) return;
    if (el.parentElement && el.parentElement.getBoundingClientRect().right > limit + 1) return;
    problems.widest.push({
      name: name(el),
      tag: el.tagName.toLowerCase(),
      width: Math.round(box.width),
      right: Math.round(box.right),
    });
  });
  problems.widest = problems.widest.slice(0, 4);

  problems.overlapping = problems.overlapping.slice(0, 5);
  return JSON.stringify(problems);
`;

const SCREENS = [
  { name: 'editor', path: '/' },
  { name: 'reflections', path: '/reflections' },
  { name: 'community', path: '/community' },
  { name: 'viewer', path: null },
  /* The sheets and the bottom bar are the parts a scaled layout breaks last. */
  {
    name: 'filters-sheet',
    path: '/reflections',
    open: '[aria-label^="Filters"]',
  },
  {
    name: 'page-menu',
    path: '/reflections',
    open: '[aria-label="Menu"]',
  },
];

let failures = 0;
for (const screen of SCREENS) {
  const d = await newDriver(vp);
  try {
    await d.get(WEB);
    await wait(1600);
    const made = await seed(d);
    const path = screen.path ?? `/reflections/${made.complete}`;
    await d.get(`${WEB}${path}`);
    await wait(2400);
    const rootSize = await d.executeScript(SCALE);
    await wait(900);
    if (screen.open) {
      const opened = await d.executeScript(
        `const el = document.querySelector(${JSON.stringify(screen.open)});
         if (!el) return 'missing';
         el.click(); return 'ok';`,
      );
      if (opened !== 'ok') console.log(`    could not open: ${screen.open}`);
      await wait(1100);
    }

    const found = JSON.parse(await d.executeScript(AUDIT));
    const bad =
      found.overflow > 0 || found.clipped.length > 0 || found.overlapping.length > 0 || found.small.length > 0;
    if (bad) failures += 1;
    console.log(`\n  ${screen.name} at ${rootSize} root (${scale * 100}% text)`);
    console.log(`    horizontal overflow: ${found.overflow}px`);
    console.log(`    clipped essential text: ${found.clipped.length}`);
    for (const item of found.clipped.slice(0, 5)) console.log(`        <${item.tag}> ${item.name}`);
    console.log(`    overlapping controls: ${found.overlapping.length}`);
    for (const pair of found.overlapping) console.log(`        ${pair.a} | ${pair.b}`);
    console.log(`    controls under 44px tall: ${found.small.length}`);
    for (const item of found.small.slice(0, 5)) console.log(`        ${item.h}px ${item.name}`);
    for (const item of found.widest ?? []) {
      console.log(`        sticks out: <${item.tag}> ${item.width}px ends at ${item.right} — ${item.name}`);
    }

    const shot = `text200-${screen.name}`;
    report(shot, await capture(d, { ...vp, out: OUT, name: shot }));
  } catch (error) {
    failures += 1;
    console.log(`  ${screen.name}: ${error.message}`);
  } finally {
    await d.quit();
  }
}
console.log(`\n  ${SCREENS.length - failures}/${SCREENS.length} screens clean at ${scale * 100}% text`);
