/*
 * Create Studio on a phone: the things that must stay true.
 *
 * Driven in a browser rather than in jsdom because the editor is a canvas —
 * jsdom has no `getContext`, so a test there proves the panels exist and
 * nothing about whether the composition can be seen or reached.
 */
import { newDriver, capture, report, wait } from './lib/viewport.mjs';
import { seed } from './lib/seed.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname;

const checks = [];

const check = (what, pass, detail = '') =>
  checks.push(`  ${pass ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);

/*
 * The screen must say something, whoever arrives.
 *
 * A visitor with no reflections reached /create and got a bar above an empty
 * screen: the setup moved into a sheet that only opens when there is
 * something to set up, and the "finish a reflection first" line had gone with
 * it. Nothing told them what to do, and nothing looked broken enough to
 * report — which is the worst kind of broken.
 */
async function checkEmptyStates() {
  for (const [label, seeded] of [['a visitor with no reflections', false], ['somebody with reflections but none chosen', true]]) {
    const d = await newDriver({ width: 390, height: 844 });
    try {
      await d.get(WEB);
      await wait(1500);
      if (seeded) await seed(d);
      await d.get(`${WEB}/create`);
      await wait(6000);
      const said = await d.executeScript(`
        const text = document.body.innerText.replace(/\s+/g, ' ').trim();
        return JSON.stringify({
          text,
          /* The bar's title alone is not the screen saying anything. */
          saysSomething: text.replace('Skip to content', '').replace('Create visual', '').trim().length > 12,
          sheet: !!document.querySelector('[role=dialog]'),
          studio: !!document.querySelector('.create-studio'),
        });
      `);
      const state = JSON.parse(said);
      check(
        `${label}: the screen is not blank`,
        state.saysSomething || state.sheet || state.studio,
        state.text.slice(0, 60),
      );
    } catch (error) {
      check(`${label}: loaded`, false, error.message);
    } finally {
      await d.quit();
    }
  }
}

await checkEmptyStates();

for (const vp of [
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 568 },
  { name: 'landscape', width: 844, height: 390 },
]) {
  const d = await newDriver(vp);
  try {
    await d.get(WEB);
    await wait(1600);
    const made = await seed(d);
    await d.get(`${WEB}/create?c=${made.complete}`);
    await wait(8000);

    const state = JSON.parse(
      await d.executeScript(`
        const doc = document.documentElement;
        const canvas = document.querySelector('.create-studio__canvas-host');
        const box = canvas ? canvas.getBoundingClientRect() : null;
        const nav = document.querySelector('nav[aria-label="Primary phone"]');
        return JSON.stringify({
          mobileMode: !!document.querySelector('.create-studio--mobile'),
          canvasPresent: !!canvas,
          canvasTop: box ? Math.round(box.top) : null,
          canvasHeight: box ? Math.round(box.height) : 0,
          aboveTheFold: box ? box.top < doc.clientHeight : false,
          documentScrolls: doc.scrollHeight > doc.clientHeight + 1,
          horizontalOverflow: doc.scrollWidth - doc.clientWidth,
          dockPresent: !!document.querySelector('.create-studio__dock'),
          globalNavVisible: nav ? getComputedStyle(nav).display !== 'none' : false,
          layersPermanent: !!document.querySelector('.create-studio__layers'),
        });
      `),
    );

    const at = `${vp.name}: `;
    check(`${at}mobile mode`, vp.name === 'landscape' ? true : state.mobileMode);
    check(`${at}canvas is present`, state.canvasPresent);
    check(`${at}canvas is above the fold`, state.aboveTheFold, `top=${state.canvasTop}`);
    check(`${at}canvas has real height`, state.canvasHeight > 120, `${state.canvasHeight}px`);
    check(`${at}document does not scroll`, !state.documentScrolls);
    check(`${at}no horizontal overflow`, state.horizontalOverflow === 0, `${state.horizontalOverflow}px`);
    check(`${at}editor dock is present`, state.dockPresent);
    check(`${at}no global bottom navigation`, !state.globalNavVisible);
    check(`${at}Layers is not a permanent column`, !state.layersPermanent);

    /* Each tool opens its own sheet, and the canvas survives it. */
    for (const tool of ['Layers', 'Properties', 'Pages']) {
      await d.executeScript(
        `[...document.querySelectorAll('.create-studio__dock button')].find(
           (b) => b.textContent.trim() === ${JSON.stringify(tool)})?.click()`,
      );
      await wait(800);
      const sheet = JSON.parse(
        await d.executeScript(`
          const open = document.querySelector('[role=dialog][aria-modal="true"]');
          const canvas = document.querySelector('.create-studio__canvas-host');
          const scrim = document.querySelector('.create-studio__scrim');
          return JSON.stringify({
            open: !!open,
            named: open ? open.getAttribute('aria-label') : null,
            canvasStillThere: !!canvas,
            scrimIsDark: scrim
              ? getComputedStyle(scrim).backgroundColor.replace(/\\s/g, '') !== 'rgba(0,0,0,0)'
              : false,
          });
        `),
      );
      check(`${at}${tool} opens as a sheet`, sheet.open, sheet.named ?? '');
      check(`${at}${tool} leaves the canvas`, sheet.canvasStillThere);
      check(`${at}${tool} has a scrim`, sheet.scrimIsDark);
      await d.executeScript(`document.querySelector('.create-studio__scrim')?.click()`);
      await wait(400);
    }

    const name = `studio-${vp.name}`;
    report(name, await capture(d, { ...vp, out: OUT, name }));
  } catch (error) {
    check(`${vp.name}: ran`, false, error.message);
  } finally {
    await d.quit();
  }
}

console.log(checks.join('\n'));
const failed = checks.filter((c) => c.includes('FAIL')).length;
console.log(`\n  ${checks.length - failed}/${checks.length} passed`);
