/*
 * The decluttered reflection card, checked from both sides.
 *
 * The owner's complaint was that too much information sat on the card. The
 * answer was to take the C.H.A.T. letters, the section names, "Not yet",
 * "Written", "Your words", "Unsaved", the word "recommended" and a Save button
 * off the face of it. That is the easy half to verify: read the text the card
 * actually paints and assert those words are not in it.
 *
 * The half that is easy to lose is the other one. Nothing here may be carried
 * by colour or shape alone, so this script also asks Chrome for its *own*
 * accessibility tree — `Accessibility.queryAXTree`, the same computation a
 * screen reader consumes, not our reading of our own markup — and asserts
 * every mark has a real name with its state inside it. Then it puts keyboard
 * focus on each mark and checks the wording actually appears, because a hint
 * that only opens for a mouse is a hint half the users never get.
 */
import { Builder, By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function until(fn, ms = 10000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await wait(150);
  }
}

async function shoot(driver, name) {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
}

/*
 * The text a person actually sees inside an element.
 *
 * `textContent` would count the visually-hidden sentences that exist precisely
 * so the marks can stay wordless, and would therefore report the clutter as
 * still present. `innerText` would count them too — `sr-only` clips rather than
 * hides. So this walks the tree and drops anything the browser is not painting:
 * display none, visibility hidden, zero opacity, and the clipped `sr-only`
 * spans. What comes back is the card as an eye receives it.
 */
const VISIBLE_TEXT = `
  const root = document.querySelector(arguments[0]);
  if (!root) return null;
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3) { out.push(node.textContent); return; }
    if (node.nodeType !== 1) return;
    if (node.classList.contains('sr-only')) return;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out.join(' ').replace(/\\s+/g, ' ').trim();
`;

/*
 * The three marks, named exactly rather than by "anything with hint in its
 * class" — the assistance panel below has its own hint and would otherwise be
 * counted as part of the card's furniture.
 */
const MARKS = [
  '[data-status][class*=mark]',
  '[class*=originMark]',
  '[class*=fieldActions] button[aria-pressed]',
].join(', ');

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,900'),
  )
  .build();

/**
 * The accessible name Chrome computes for a selector, from Chrome.
 *
 * Reading `aria-label` back out of our own markup would only prove we typed
 * what we typed. This asks the browser what the name resolves to after
 * labelling, hidden text and role handling — which is what assistive
 * technology is handed.
 */
async function axNames(selector) {
  const { root } = await driver.sendAndGetDevToolsCommand('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await driver.sendAndGetDevToolsCommand('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector,
  });

  const named = [];
  for (const nodeId of nodeIds) {
    const { nodes } = await driver.sendAndGetDevToolsCommand('Accessibility.queryAXTree', {
      nodeId,
    });
    /* The element's own AX node is the one carrying the backing DOM node. */
    const self = nodes.find((node) => !node.ignored && node.name?.value);
    named.push({
      name: self?.name?.value ?? '',
      role: self?.role?.value ?? '',
      pressed: self?.properties?.find((p) => p.name === 'pressed')?.value?.value,
    });
  }
  return named;
}

try {
  await driver.sendDevToolsCommand('DOM.enable', {});
  await driver.sendDevToolsCommand('Accessibility.enable', {});

  // --- get to a reflection with something written in it -----------------
  await driver.get('http://localhost:5173/login');
  await until(async () => (await driver.findElements(By.css('#email'))).length === 1);
  await driver.findElement(By.css('#email')).sendKeys(`marks${Date.now()}@example.com`);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).includes('Create an account')) {
      await button.click();
      break;
    }
  }
  await wait(400);
  await driver.findElement(By.css('button[type=submit]')).click();
  await until(async () => !/\/login/.test(await driver.getCurrentUrl()));

  const composer = await until(async () =>
    (await driver.findElements(By.css('textarea[aria-label="Write your reflection"]'))).length === 1,
  );
  check('reached Reflect', composer);
  await driver
    .findElement(By.css('textarea[aria-label="Write your reflection"]'))
    .sendKeys(
      'Romans 8:28 keeps meeting me this week. I cannot see how it works together and I want to trust it anyway.',
    );
  await driver.findElement(By.css('form button[type=submit]')).click();
  await until(async () => (await driver.findElements(By.css('[class*=fieldInput]'))).length === 4);

  /*
   * Two written and two empty, so both ends of the traffic light are on screen
   * at once and the photographs show the real mixture rather than a best case.
   */
  /*
   * With a real provider live, sending the first message can raise a sheet —
   * a suggested title, a passage to confirm. It is not what is under test and
   * it sits over the card, so it is dismissed the way a person would.
   */
  const dismissSheets = async () => {
    for (let i = 0; i < 4; i++) {
      if ((await driver.findElements(By.css('[role=dialog]'))).length === 0) return;
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await wait(500);
    }
  };
  await wait(2500);
  await dismissSheets();

  const write = async (index, text) => {
    await dismissSheets();
    const area = (await driver.findElements(By.css('[class*=fieldInput]')))[index];
    await area.click();
    await area.sendKeys(text);
    await wait(500);
    /* Blur saves; the save is what turns the traffic light and the toggle. */
    await driver.executeScript('document.activeElement.blur()');
    await wait(900);
  };

  await write(0, 'Romans 8:28 — And we know that in all things God works for the good of those who love him.');
  await write(2, 'I will pray before I react, and say the promise out loud when I cannot feel it.');

  /*
   * Nothing focused before the face is read. A hint *should* be open while its
   * mark has focus — that is the feature — so leaving focus somewhere would
   * photograph a tooltip and call it clutter.
   */
  await driver.executeScript('document.activeElement.blur()');
  await wait(400);

  const face = await driver.executeScript(VISIBLE_TEXT, '[class*=fields]');
  if (face === null) throw new Error('the artifact column was not found');

  // --- 1. the words are off the face ------------------------------------
  const labels = ['Content', 'Heart', 'Application', 'Testimony'];
  const printed = labels.filter((word) => new RegExp(`\\b${word}\\b`).test(face));
  check('no C/H/A/T section words on the card face', printed.length === 0, printed.join(', '));

  /* The single letters were the markers. A lone C, H, A or T is one surviving. */
  const letters = await driver.executeScript(
    `return [...document.querySelectorAll('[class*=fields] *')]
       .filter((el) => !el.children.length && /^[CHAT]$/.test((el.textContent || '').trim())).length`,
  );
  check('no single-letter markers left', letters === 0, `${letters} found`);

  // --- 2. status is a text-free indicator -------------------------------
  const lights = await driver.findElements(By.css('[data-status][class*=mark]'));
  const lightText = await driver.executeScript(
    `return [...document.querySelectorAll('[data-status][class*=mark]')]
       .map((el) => (el.textContent || '').trim()).join('')`,
  );
  check('a status indicator per field', lights.length === 4, `${lights.length} found`);
  check('and it prints no text', lightText === '', JSON.stringify(lightText));
  check('"Not yet" / "Written" are gone', !/Not yet|Written/.test(face));

  /*
   * Colour is not the only difference. The three states draw different SVG, so
   * the shape distinguishes them for anyone who cannot separate the hues.
   */
  const shapes = await driver.executeScript(
    `const seen = {};
     for (const el of document.querySelectorAll('[data-status][class*=mark]')) {
       seen[el.dataset.status] = el.querySelector('svg').innerHTML;
     }
     const states = Object.keys(seen);
     return { states, distinct: new Set(Object.values(seen)).size };`,
  );
  check(
    'the traffic light differs in shape, not only hue',
    shapes.distinct === shapes.states.length && shapes.states.length > 1,
    `${shapes.states.join(' + ')} → ${shapes.distinct} distinct drawings`,
  );

  // --- 3. provenance is an icon -----------------------------------------
  const origins = await driver.findElements(By.css('[class*=originMark]'));
  const originVisible = await driver.executeScript(
    `return [...document.querySelectorAll('[class*=originMark]')].map((el) => {
       let text = '';
       for (const n of el.childNodes) {
         if (n.nodeType === 3) text += n.textContent;
         else if (n.nodeType === 1 && !n.classList.contains('sr-only')) text += n.textContent;
       }
       return text.trim();
     }).join('')`,
  );
  const originSvg = await driver.executeScript(
    `return [...document.querySelectorAll('[class*=originMark] svg')].length`,
  );
  check('provenance shown on the written fields', origins.length === 2, `${origins.length} found`);
  check('as an icon with no visible words', originVisible === '' && originSvg === origins.length);
  check('"Your words" / "AI" are not printed', !/Your words|AI assisted|AI drafted/.test(face));

  // --- 4. the counter drops "recommended" -------------------------------
  const counters = await driver.executeScript(
    `return [...document.querySelectorAll('[class*=counter]')].map((el) => el.textContent.trim())`,
  );
  check(
    'the counter keeps the count against the limit',
    counters.length === 4 && counters.every((t) => /\d+\s*\/\s*\d+/.test(t)),
    counters.join(' | '),
  );
  check(
    'and no longer says "recommended"',
    !/recommended/i.test(face),
    counters.join(' | '),
  );

  // --- 5. save is one toggle --------------------------------------------
  const saveButtons = await driver.executeScript(
    `return [...document.querySelectorAll('[class*=fieldActions] button')]
       .map((b) => ({
         pressed: b.getAttribute('aria-pressed'),
         text: (b.textContent || '').replace(/\\s+/g, ' ').trim(),
         label: b.getAttribute('aria-label'),
       }))`,
  );
  const toggles = saveButtons.filter((b) => b.pressed !== null);
  check('exactly one save control per field', toggles.length === 4, `${toggles.length} toggles`);
  check(
    'it is a toggle carrying its own state',
    toggles.every((b) => b.pressed === 'true' || b.pressed === 'false'),
    toggles.map((b) => b.pressed).join(', '),
  );
  check('no separate Save button or saved status text', !/\bSave\b|\bUnsaved\b/.test(face));

  // --- the accessibility half, read out of Chrome's own tree ------------
  const lightNames = await axNames('[data-status][class*=mark]');
  const originNames = await axNames('[class*=originMark]');
  const toggleNames = await axNames('[class*=fieldActions] button[aria-pressed]');

  console.log('\n  accessible names as Chrome computes them:');
  for (const group of [lightNames, originNames, toggleNames]) {
    for (const node of group) {
      console.log(`    ${node.role.padEnd(8)} ${JSON.stringify(node.name)}`);
    }
  }
  console.log('');

  check(
    'every traffic light has an accessible name',
    lightNames.length === 4 && lightNames.every((n) => n.name.trim().length > 0),
    lightNames.map((n) => n.name).join(' | '),
  );
  check(
    'and the name says which section and what state',
    lightNames.every((n) => /Content|Heart|Application|Testimony/.test(n.name)) &&
      lightNames.every((n) => /written|nothing/i.test(n.name)),
  );
  check(
    'every provenance icon has an accessible name',
    originNames.length === 2 && originNames.every((n) => /words|AI/i.test(n.name)),
    originNames.map((n) => n.name).join(' | '),
  );
  check(
    'every save toggle has a name stating its current state',
    toggleNames.length === 4 &&
      toggleNames.every((n) => /saved|unsaved/i.test(n.name)) &&
      toggleNames.every((n) => n.pressed === 'true' || n.pressed === 'false'),
    toggleNames.map((n) => `${n.name} [pressed=${n.pressed}]`).join(' | '),
  );

  /*
   * The hint on focus, not on hover alone. Focus is moved with the keyboard's
   * own mechanism and the tooltip is measured for real: computed opacity and
   * visibility, not the presence of a class.
   */
  const MARK_STATE = `
    const marks = [...document.querySelectorAll(${JSON.stringify(MARKS)})];
    const el = marks[arguments[0]];
    if (arguments[1] === 'focus') el.focus();
    if (arguments[1] === 'blur') el.blur();
    const tip = el.parentElement.querySelector('[class*=hintText]');
    const cs = tip && getComputedStyle(tip);
    return {
      count: marks.length,
      focusable: el.tabIndex >= 0,
      opacity: cs && cs.opacity,
      visibility: cs && cs.visibility,
      text: tip && tip.textContent.trim(),
    };`;

  /*
   * Measured from here rather than inside one page script, because the tooltip
   * fades in: read straight after `focus()` and the computed opacity is still
   * the 0 it is travelling from, which would report a working hint as broken.
   */
  const hintOnFocus = { count: 0, focusable: 0, hiddenBefore: 0, shownOnFocus: 0, texts: [] };
  const markCount = (await driver.executeScript(MARK_STATE, 0, 'none')).count;
  hintOnFocus.count = markCount;
  for (let i = 0; i < markCount; i++) {
    const rest = await driver.executeScript(MARK_STATE, i, 'blur');
    if (rest.focusable) hintOnFocus.focusable++;
    if (rest.opacity === '0' && rest.visibility === 'hidden') hintOnFocus.hiddenBefore++;

    await driver.executeScript(MARK_STATE, i, 'focus');
    await wait(400);
    const focused = await driver.executeScript(MARK_STATE, i, 'none');
    if (focused.opacity === '1' && focused.visibility === 'visible') hintOnFocus.shownOnFocus++;
    hintOnFocus.texts.push(focused.text);
    await driver.executeScript(MARK_STATE, i, 'blur');
  }
  check(
    'every mark is reachable by keyboard',
    hintOnFocus.focusable === hintOnFocus.count && hintOnFocus.count === 10,
    `${hintOnFocus.focusable}/${hintOnFocus.count} focusable`,
  );
  check(
    'the hint is hidden at rest and appears on keyboard focus, not hover alone',
    hintOnFocus.hiddenBefore === hintOnFocus.count &&
      hintOnFocus.shownOnFocus === hintOnFocus.count,
    `${hintOnFocus.shownOnFocus}/${hintOnFocus.count} opened on focus`,
  );

  /* Cleaning up the card is not a licence to hide where the keyboard is. */
  const rings = await driver.executeScript(
    `const marks = [...document.querySelectorAll(${JSON.stringify(MARKS)})];
     let ringed = 0;
     for (const el of marks) {
       el.focus();
       const cs = getComputedStyle(el);
       if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ringed++;
       el.blur();
     }
     return ringed;`,
  );
  check('focus stays visible on every mark', rings === hintOnFocus.count, `${rings} ringed`);

  /* Targets a thumb can hit, even though the drawing inside them is small. */
  const targets = await driver.executeScript(
    `return [...document.querySelectorAll(${JSON.stringify(MARKS)})]
       .map((el) => Math.round(Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)))`,
  );
  check(
    'touch targets stay around 40px',
    targets.every((n) => n >= 38),
    `${Math.min(...targets)}px smallest`,
  );

  /*
   * Non-text contrast, in both themes.
   *
   * These marks are now the only visible carrier of their information, which
   * puts them under WCAG 1.4.11 rather than under nothing: 3:1 against what is
   * behind them. The colour is read off the rendered page and the ratio
   * computed, because "it looked fine in the screenshot" is not a measurement.
   */
  const CONTRAST = `
    const parse = (c) => c.match(/[\\d.]+/g).map(Number);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const behind = (el) => {
      let p = el;
      while (p) {
        const bg = parse(getComputedStyle(p).backgroundColor);
        if (bg.length < 4 || bg[3] > 0) return bg;
        p = p.parentElement;
      }
      return [255, 255, 255];
    };
    return [...document.querySelectorAll(${JSON.stringify(MARKS)})].map((el) => {
      const fg = lum(parse(getComputedStyle(el).color));
      const bg = lum(behind(el));
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      return Math.round(ratio * 100) / 100;
    });`;

  const lightRatios = await driver.executeScript(CONTRAST);
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await wait(500);
  const darkRatios = await driver.executeScript(CONTRAST);
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', { features: [] });
  await wait(500);

  check(
    'the marks clear 3:1 against their background in light',
    lightRatios.every((r) => r >= 3),
    `worst ${Math.min(...lightRatios)}:1`,
  );
  check('and in dark', darkRatios.every((r) => r >= 3), `worst ${Math.min(...darkRatios)}:1`);

  // --- photographs ------------------------------------------------------
  /*
   * Nothing focused, scrolled back to the top of the artifact. The question is
   * whether the card is quieter at rest, and a tooltip left open by the focus
   * checks above would be answering a different one.
   */
  const settle = async () => {
    await driver.executeScript(
      `document.activeElement.blur();
       const el = document.querySelector('[class*=fields]');
       if (el) {
         let p = el;
         while (p && p !== document.body) {
           if (p.scrollHeight > p.clientHeight + 4) { p.scrollTop = 0; break; }
           p = p.parentElement;
         }
       }
       window.scrollTo(0, 0);`,
    );
    await wait(600);
  };

  await settle();
  await shoot(driver, 'card-marks-1280');
  await driver.manage().window().setRect({ width: 390, height: 844 });
  await wait(900);
  await settle();
  /*
   * One column, so the card is below the fold at this width; the marks are the
   * subject of the photograph, so the photograph is framed on them.
   */
  await driver.executeScript(
    `const foot = document.querySelectorAll('[class*=fieldFoot]')[0];
     if (foot) foot.scrollIntoView({ block: 'center' });`,
  );
  await wait(600);
  await shoot(driver, 'card-marks-390');
  await driver.manage().window().setRect({ width: 1280, height: 900 });
  await wait(600);
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await wait(600);
  await settle();
  await shoot(driver, 'card-marks-1280-dark');
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', { features: [] });

  const severe = (await driver.manage().logs().get('browser')).filter(
    (entry) =>
      entry.level.name === 'SEVERE' &&
      !/favicon/.test(entry.message) &&
      !/auth\/me/.test(entry.message),
  );
  check('no severe console errors', severe.length === 0, severe.map((e) => e.message).join(' | '));

  console.log(`\n  the card face reads: ${JSON.stringify(face.slice(0, 400))}\n`);

  const failed = results.filter((r) => !r.passed);
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await driver.quit();
}
