/*
 * How much of the C.H.A.T. is on screen at once.
 *
 * The brief for the compact editor asks for roughly two and a half to three
 * sections visible on a normal laptop, and for the editor to sit between 600
 * and 700px wide with the flanks around it. Those are measurements, so they
 * are measured rather than asserted: this drives a real browser, writes a real
 * reflection, and reports the column widths and how many sections fit above
 * the fold.
 *
 *   npm run dev        # in another terminal
 *   node scripts/verify/editor-density.mjs
 */
import { Builder, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SECTIONS = {
  content:
    'Romans 8:28 (NIV) — And we know that in all things God works for the good of those who love him, who have been called according to his purpose.',
  heart:
    'I have read this verse for years and this is the first week it has cost me anything to believe it.',
  application:
    'I am going to stop asking for the outcome and start asking to be the kind of person who can hold on without one.',
  testimony: 'He has not explained it. He has kept me, and I am still here.',
};

async function measure(driver) {
  return driver.executeScript(`
    const px = (n) => Math.round(n);
    const workspace = document.querySelector('[class*=workspace]');
    const columns = workspace ? getComputedStyle(workspace).gridTemplateColumns : '';
    const fields = [...document.querySelectorAll('article[class*=field]')];
    const viewport = innerHeight;

    /* A section counts as visible in proportion to how much of it is on screen. */
    let visible = 0;
    for (const field of fields) {
      const box = field.getBoundingClientRect();
      const shown = Math.max(0, Math.min(box.bottom, viewport) - Math.max(box.top, 0));
      if (box.height > 0) visible += shown / box.height;
    }

    const editor = document.querySelector('[class*=artifact]');
    const head = document.querySelector('[class*=artifactHead]');
    const meta = document.querySelector('[class*=artifactMeta]');
    return {
      columns,
      editorWidth: editor ? px(editor.getBoundingClientRect().width) : null,
      headerHeight: px((head?.getBoundingClientRect().height ?? 0) + (meta?.getBoundingClientRect().height ?? 0)),
      sections: fields.length,
      visibleSections: Math.round(visible * 100) / 100,
      viewport,
      /* Persistent controls inside the sections, which is what was reduced. */
      sectionButtons: fields.reduce((n, field) => n + field.querySelectorAll('button').length, 0),
    };
  `);
}

async function run(label, width, height) {
  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(
      new chrome.Options().addArguments('--headless=new', '--no-sandbox', `--window-size=${width},${height}`),
    )
    .build();
  try {
    console.log(`\n===== ${label} (${width}x${height}) =====`);
    await driver.get(WEB);
    await wait(1500);
    await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(500);

    /*
     * Write, then take the guest option when the page asks how to keep it.
     *
     * The question arrives on the save, not on the keystroke, so it is waited
     * for rather than looked for once — a probe that checks too early finds
     * nothing and then measures a page with a modal over it.
     */
    const content = await driver.findElements(By.css('#chat-field-content'));
    if (content.length) {
      await content[0].sendKeys(SECTIONS.content);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const choice = await driver.executeScript(`
          const button = [...document.querySelectorAll('button')]
            .find((b) => b.textContent.includes('Continue as guest'));
          if (button) button.click();
          return Boolean(button);
        `);
        if (choice) break;
        await wait(400);
      }
      await wait(2000);
    }

    for (const [type, text] of Object.entries(SECTIONS)) {
      const area = await driver.findElements(By.css(`#chat-field-${type}`));
      if (!area.length) continue;
      const already = await area[0].getAttribute('value');
      if (!already) await area[0].sendKeys(text);
      await wait(250);
    }
    await driver.executeScript('window.scrollTo(0, 0)');
    await wait(1200);
    const modal = await driver.findElements(By.css('[role=dialog]'));
    if (modal.length) console.log('  NOTE: a dialog is open; the measurement is behind it');

    const m = await measure(driver);
    console.log(`  columns          ${m.columns}`);
    console.log(`  editor width     ${m.editorWidth}px`);
    console.log(`  header height    ${m.headerHeight}px`);
    console.log(`  sections visible ${m.visibleSections} of ${m.sections}`);
    console.log(`  buttons inside the sections: ${m.sectionButtons}`);

    writeFileSync(new URL(`editor-${label}.png`, OUT), await driver.takeScreenshot(), 'base64');
    console.log(`  shot out/editor-${label}.png`);
    return m;
  } finally {
    await driver.quit();
  }
}

await run('1440', 1440, 900);
await run('1280', 1280, 800);
/* The narrow layout is a separate promise and is checked, not assumed. */
await run('390', 390, 844);
