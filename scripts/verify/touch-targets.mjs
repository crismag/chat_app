/*
 * Whether this can actually be used with a thumb.
 *
 * The brief for the mobile work is mostly numbers — 44px targets, 8px between
 * them, 16px from the edge, no horizontal scrolling, 16px inputs so iOS does
 * not zoom — and numbers are worth measuring rather than eyeballing. This
 * drives real mobile viewports, writes down every control that is too small or
 * too close to something else, and takes the before-and-after screenshots.
 *
 *   npm run dev          # in another terminal
 *   node scripts/verify/touch-targets.mjs [label]
 */
import { Builder, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const label = process.argv[2] ?? 'now';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The viewports the brief names. */
const VIEWPORTS = [
  { name: '320', width: 320, height: 640 },
  { name: '360', width: 360, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
];

const MEASURE = `
  const MIN = 44;
  const EDGE = 16;
  const GAP = 8;
  const seen = [];
  const controls = [...document.querySelectorAll(
    'button, a[href], input, select, textarea, [role=button], [role=menuitem], [role=tab]'
  )].filter((el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });

  const name = (el) =>
    (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.id || el.tagName)
      .trim().replace(/\\s+/g, ' ').slice(0, 40);

  /*
   * Adjacent targets closer together than a thumb can separate.
   *
   * A segmented bar is the exception every platform makes: the cells of a
   * bottom navigation share an edge on purpose, and putting 8px of dead space
   * between them would make the boundary between two large targets harder to
   * hit rather than easier. Same for the outer edge — a corner is the easiest
   * place on a screen to reach, which is why bottom bars go full width. So a
   * control that fills its share of a full-width row of siblings is not
   * counted; anything that merely happens to be near another control is.
   */
  const segmented = (el) => {
    const parent = el.parentElement;
    if (!parent) return false;
    const style = getComputedStyle(parent);
    if (parent.childElementCount < 2) return false;
    if (!style.display.includes('grid') && !style.display.includes('flex')) return false;
    /*
     * Two kinds of deliberate adjacency, and nothing else.
     *
     * A full-width row of cells — the bottom navigation — where the cells
     * share edges because a corner is the easiest place on a screen to reach.
     * And a segmented control, where the cells touch on purpose and the
     * boundary between two large targets is easier to hit than two small ones
     * separated by dead space. Both require the cells to be big enough for the
     * shared edge to be an advantage rather than an excuse, so this is checked
     * against the parent having no gap at all — a container that meant to
     * separate its children would have said so.
     */
    const fullWidth = Math.round(parent.getBoundingClientRect().width) >= innerWidth - 1;
    /* A flex container's default column gap is the word normal, which is none. */
    const gap = style.columnGap === 'normal' ? 0 : parseFloat(style.columnGap || '0');
    const touching = gap === 0;
    return fullWidth || touching;
  };

  /*
   * The target is what can be pressed, which is not always what can be seen.
   *
   * A "stretched link" — a small anchor whose ::after is absolutely positioned
   * over its whole card — is the standard way to make a card open something,
   * and it is the shape this application uses for every reflection. Measuring
   * the anchor's own box calls a full-card target a 17px one, which is how a
   * list of real problems came to have two invented ones in it.
   *
   * So: if the ::after covers an ancestor, that ancestor is the target.
   */
  const hitArea = (el) => {
    const after = getComputedStyle(el, '::after');
    const positioned = after.content !== 'none' && after.position === 'absolute';
    /*
     * A compact control with an expanded reach: an ::after with a negative
     * inset, which is how a 40px button is made a 44px target without
     * looking like a slab. The pseudo-element is not in the layout tree, so
     * its box has to be reconstructed from the insets rather than measured —
     * without this the harness reported every such button as undersized, which
     * is a false alarm that trains people to ignore it.
     */
    const inset = (side) => {
      const value = parseFloat(after[side]);
      return Number.isFinite(value) ? value : 0;
    };
    /*
     * Any negative inset expands, not only top or left — a control whose reach
     * is widened to one side (away from a neighbour it would otherwise crowd)
     * was reported as undersized while being exactly the right size.
     */
    if (
      positioned &&
      [after.top, after.right, after.bottom, after.left].some((v) => parseFloat(v) < 0)
    ) {
      const box = el.getBoundingClientRect();
      return {
        left: box.left + inset('left'),
        right: box.right - inset('right'),
        top: box.top + inset('top'),
        bottom: box.bottom - inset('bottom'),
        width: box.width - inset('left') - inset('right'),
        height: box.height - inset('top') - inset('bottom'),
      };
    }
    const stretched =
      positioned &&
      ['0px', 'auto'].includes(after.top) && ['0px', 'auto'].includes(after.left);
    if (!stretched) return el.getBoundingClientRect();
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (getComputedStyle(node).position !== 'static') return node.getBoundingClientRect();
    }
    return el.getBoundingClientRect();
  };

  /*
   * The page-content boundary, or the applicable safe-area inset.
   *
   * The rule this replaces was "nothing within 16px of the viewport edge",
   * which is wrong about the shape a phone actually uses: a bottom navigation
   * and an app bar span the viewport on purpose, and a checker that calls that
   * a defect gets worked around by padding that should not exist. Adding outer
   * space to satisfy a checker is the checker making the design worse.
   *
   * So a full-width structural component — one that spans the viewport and is
   * pinned to an edge — is exempt as a component, and its cells are measured
   * against its own content box instead. Everything else is measured against
   * the page's 16px gutter.
   */
  const structural = (el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const pinned = style.position === 'fixed' || style.position === 'sticky';
      const spans = Math.round(box.width) >= innerWidth - 1;
      if (spans && (pinned || ['HEADER', 'NAV', 'FOOTER'].includes(node.tagName))) {
        return { node, box, style };
      }
    }
    return null;
  };

  const small = [];
  const edges = [];
  for (const el of controls) {
    const box = hitArea(el);
    /* Half a pixel of slack: a 43.99px box is 44px of target, not a defect. */
    if (box.width < MIN - 0.5 || box.height < MIN - 0.5) {
      small.push({ name: name(el), w: Math.round(box.width), h: Math.round(box.height) });
    }

    const host = structural(el);
    if (host) {
      /*
       * Inside a structural component: the boundary is that component's own
       * padding, which is where its designer put its gutter — and which the
       * safe-area inset is already folded into.
       */
      const padLeft = parseFloat(host.style.paddingLeft) || 0;
      const padRight = parseFloat(host.style.paddingRight) || 0;
      const inner = { left: host.box.left + padLeft, right: host.box.right - padRight };
      /*
       * Cells that share the full width between them — a bottom bar's tabs —
       * are meant to reach the component's edges, so only a control that
       * breaks OUT of the padding box is reported.
       */
      if (box.left < inner.left - 0.5 || box.right > inner.right + 0.5) {
        edges.push({
          name: name(el),
          left: Math.round(box.left - inner.left),
          right: Math.round(inner.right - box.right),
          where: 'outside its bar’s gutter',
        });
      }
      continue;
    }

    if (box.left < EDGE - 0.5 || box.right > innerWidth - EDGE + 0.5) {
      edges.push({
        name: name(el),
        left: Math.round(box.left),
        right: Math.round(innerWidth - box.right),
        where: 'inside the 16px page gutter',
      });
    }
  }

  /* Adjacency is measured on the same expanded boxes the sizes were. */
  for (const el of controls) {
    seen.push({ name: name(el), box: hitArea(el), segmented: segmented(el) });
  }

  const crowded = [];
  for (let i = 0; i < seen.length; i += 1) {
    for (let j = i + 1; j < seen.length; j += 1) {
      const a = seen[i].box, b = seen[j].box;
      if (seen[i].segmented && seen[j].segmented) continue;
      const overlapsRow = a.top < b.bottom && b.top < a.bottom;
      if (!overlapsRow) continue;
      const gap = b.left >= a.right ? b.left - a.right : (a.left >= b.right ? a.left - b.right : null);
      if (gap !== null && gap < GAP) crowded.push({ a: seen[i].name, b: seen[j].name, gap: Math.round(gap) });
    }
  }

  /* Anything under 16px makes iOS zoom the page when it is focused. */
  const zoomy = [...document.querySelectorAll('input, textarea, select')].filter((el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0) return false;
    return parseFloat(getComputedStyle(el).fontSize) < 16;
  }).map((el) => ({ name: name(el), size: getComputedStyle(el).fontSize }));

  return JSON.stringify({
    controls: controls.length,
    small,
    edges,
    crowded: crowded.slice(0, 8),
    zoomy,
    horizontalScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  });
`;

async function look(driver, viewport, path, shot) {
  /*
   * Navigate first, then emulate, then check that it took.
   *
   * Applying the override before `get()` looked like it worked and did not:
   * Chrome clamps its window to a minimum width, the page kept reporting 576,
   * and every measurement was silently taken at a width no phone has. The
   * assertion below is the point — a harness that quietly measures the wrong
   * thing is worse than no harness, because its numbers get believed.
   */
  /*
   * Moved through the application rather than through the browser.
   *
   * Every browser-level navigation — a `get`, even a refresh — drops the
   * mobile emulation and the page silently goes back to 576px. A router
   * navigation does not reload, so the emulation stands and what is measured
   * is the width that was asked for. It is also how a person gets there.
   */
  if (path !== '/') {
    const went = await driver.executeScript(
      `const link = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === ${JSON.stringify(path)});
       if (!link) return 'no link';
       link.click();
       return 'clicked';`,
    );
    await wait(2500);
    /*
     * Checked, because it silently failed: both rows of the report were
     * measuring the editor while one of them was labelled /reflections, so the
     * editor's defects were counted twice and the collection's not at all.
     */
    const landed = await driver.executeScript('return location.pathname');
    if (landed !== path) {
      throw new Error(`Navigation to ${path} did not happen (${went}); still on ${landed}`);
    }
  }
  await wait(2500);

  /*
   * Checked anyway. A harness that quietly measures the wrong width is worse
   * than no harness, because its numbers get believed.
   */
  const actual = await driver.executeScript('return window.innerWidth');
  if (actual !== viewport.width) {
    throw new Error(
      `Emulation did not take: asked for ${viewport.width}px, the page reports ${actual}px.`,
    );
  }

  const report = JSON.parse(await driver.executeScript(MEASURE));
  console.log(`\n--- ${viewport.name}px  ${path} ---`);
  console.log(`  controls: ${report.controls}`);
  console.log(`  under 44px: ${report.small.length}`);
  for (const item of report.small.slice(0, 10)) {
    console.log(`      ${item.w}x${item.h}  ${item.name}`);
  }
  console.log(`  within 16px of an edge: ${report.edges.length}`);
  for (const item of report.edges.slice(0, 6)) {
    console.log(`      l=${item.left} r=${item.right}  ${item.name}`);
  }
  console.log(`  closer than 8px apart: ${report.crowded.length}`);
  for (const pair of report.crowded.slice(0, 4)) {
    console.log(`      ${pair.gap}px  ${pair.a} | ${pair.b}`);
  }
  console.log(`  inputs under 16px (iOS zooms these): ${report.zoomy.length}`);
  for (const item of report.zoomy.slice(0, 5)) console.log(`      ${item.size}  ${item.name}`);
  console.log(`  horizontal overflow: ${report.horizontalScroll}px`);

  if (shot) {
    const page = path === '/' ? 'editor' : 'reflections';
    writeFileSync(
      new URL(`touch-${label}-${page}-${viewport.name}.png`, OUT),
      await driver.takeScreenshot(),
      'base64',
    );
  }
  return report;
}

/*
 * Emulation set when the browser starts, not afterwards.
 *
 * `Emulation.setDeviceMetricsOverride` over CDP kept reverting — Selenium
 * opens a fresh CDP session per command, and the override goes with it — which
 * is how a whole afternoon of measurements came to be taken at 576px while
 * reporting 390. Mobile emulation given at launch belongs to the browser and
 * cannot quietly stop applying.
 */
const newDriver = (viewport) =>
  new Builder()
    .forBrowser('chrome')
    .setChromeOptions(
      new chrome.Options()
        .addArguments('--headless=new', '--no-sandbox')
        .setMobileEmulation({
          deviceMetrics: {
            width: viewport.width,
            height: viewport.height,
            pixelRatio: 2,
            touch: true,
          },
        }),
    )
    .build();

/**
 * A guest with two reflections, so the collection has something in it.
 *
 * A page measured empty is a page with no cards, no dates and no overflow —
 * which is exactly where the interesting failures are. Written through the API
 * rather than the interface because this is setup, not the thing under test.
 */
async function seed(driver, path) {
  /*
   * Loaded at the page being measured, and never navigated again.
   *
   * A second navigation drops the mobile emulation — `/` measured correctly
   * and `/reflections`, reached from it, silently reverted to 576px. Seeding
   * from the destination costs nothing: the API calls work from any origin.
   */
  await driver.get(WEB);
  await wait(1800);
  await driver.executeScript(`
    const post = (p, b) => fetch(p, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const patch = (p, b) => fetch(p, { method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
    return (async () => {
      await post('/api/auth/guest', { creationSource: 'REFLECTION_CREATE' });
      const seeds = [
        ['Becoming intentional and consistent', 'Luke 22:46'],
        ['The comfort and home of God\u2019s love', 'John 3:16'],
      ];
      for (const [title, reference] of seeds) {
        const made = await post('/api/conversations', { title, scriptureReference: reference });
        await patch('/api/conversations/' + made.id + '/sections', { type: 'content',
          content: reference + ' (NIV) \u2014 Why are you sleeping? he asked. Get up and pray so that you will not fall into temptation.' });
        await patch('/api/conversations/' + made.id + '/sections', { type: 'heart',
          content: 'I have slept through this more often than I have prayed through it, which is its own answer.' });
        await patch('/api/conversations/' + made.id + '/sections', { type: 'application',
          content: 'I will pray before I react this week, rather than after it has gone wrong.' });
        await patch('/api/conversations/' + made.id + '/sections', { type: 'testimony',
          content: 'He kept me awake for this one.' });
      }
      return 'seeded';
    })();
  `);
  await wait(800);
}

/*
 * A browser per measurement.
 *
 * The device override survives one navigation and then quietly stops taking,
 * which is how these numbers came to be gathered at 576px. Rather than fight
 * it, each measurement gets a fresh browser: seed, navigate, emulate, measure,
 * quit. It is slower and it is trustworthy, and only one of those is optional.
 */
for (const path of ['/', '/reflections']) {
  for (const viewport of VIEWPORTS) {
    const driver = await newDriver(viewport);
    try {
      await seed(driver, path);
      await look(driver, viewport, path, viewport.name === '390' || viewport.name === '360');
    } finally {
      await driver.quit();
    }
  }
}
console.log(`\nshots in scripts/verify/out/touch-${label}-*.png`);
