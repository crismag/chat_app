/*
 * Reflections — driven for real, against the running dev server.
 *
 * The claim this script exists to test is the one a screenshot cannot make:
 * that the page's layout follows the width of its *container* and not the
 * width of the window. So the interesting measurement holds the viewport at
 * 1280px, squeezes only the element the page sits inside, and reads back the
 * computed `grid-template-columns`. A viewport media query would keep
 * answering "three columns" the whole way down, which is exactly the bug the
 * collapsible sidebar would otherwise produce.
 */
import { Builder, By, Key, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const APP = 'http://localhost:5173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const shot = async (driver, name) => {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
  console.log(`  saved ${name}.png`);
};

/*
 * WebDriver's clear() empties the DOM value without dispatching the events a
 * controlled React input listens for, so the component keeps its old state and
 * the page never updates. Typing the deletion does what a person does.
 */
const clearField = async (element) => {
  await element.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE);
};

const columns = (value) => (value ? value.trim().split(/\s+/).length : 0);

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,1000'),
  )
  .build();

try {
  /* --- register ------------------------------------------------------- */

  await driver.get(`${APP}/login`);
  await driver.wait(until.elementLocated(By.css('#email')), 10000);
  const email = `reflections${Date.now()}@example.com`;
  await driver.findElement(By.css('#email')).sendKeys(email);
  await driver.findElement(By.css('#password')).sendKeys('password123');
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).includes('Create an account')) {
      await button.click();
      break;
    }
  }
  await wait(300);
  await driver.findElement(By.css('button[type=submit]')).click();
  await driver.wait(async () => !(await driver.getCurrentUrl()).includes('/login'), 10000);
  console.log('registered', email);

  /* --- the empty state, before anything has been written --------------- */

  await driver.get(`${APP}/reflections`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await wait(900);
  console.log('empty heading:', await driver.findElement(By.css('h1')).getText());
  const emptyCopy = await driver.executeScript(
    "return document.querySelector('main')?.innerText ?? ''",
  );
  console.log(
    '  empty state present:',
    emptyCopy.includes('Your reflections will appear here') &&
      emptyCopy.includes('Start your first reflection'),
  );
  await shot(driver, 'reflections-empty-1280');

  /* --- content, created through the API the app itself uses ------------ */

  const seeded = await driver.executeScript(async () => {
    const post = (path, body) =>
      fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then((r) => r.json());
    const patch = (path, body) =>
      fetch(path, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    const drafts = [
      {
        title: 'Trusting while I cannot see',
        scriptureReference: 'Romans 8:28',
        message: 'Today this passage reminded me that uncertainty is not abandonment.',
        sections: {
          content: 'Paul is writing to a church under real pressure, not a comfortable one.',
          heart: 'It met the part of me that wants the outcome before the obedience.',
        },
      },
      {
        title: 'Be still and know',
        scriptureReference: 'Psalm 46:10',
        message: 'Stillness has felt like wasted time this week.',
        sections: {
          content: 'A psalm sung while the nations rage and the earth gives way.',
          heart: 'Being still is not doing nothing; it is refusing to panic.',
          application: 'Ten minutes before the phone tomorrow morning.',
          testimony: 'The day I stopped rehearsing the argument, it lost its grip.',
        },
      },
      {
        title: 'A lamp to my feet',
        scriptureReference: 'Psalm 119:105',
        message: 'Enough light for the next step, not the whole road.',
        sections: { content: 'The longest psalm, entirely about the word of God.' },
      },
      {
        title: 'The vine and the branches',
        scriptureReference: 'John 15:5',
        message: 'Fruit is evidence of connection, not of effort.',
        sections: {
          content: 'Jesus speaks this on the last night, walking to Gethsemane.',
          heart: 'I have been trying to produce what only abiding can grow.',
        },
      },
      {
        title: 'Bread in the wilderness',
        scriptureReference: 'Exodus 16:4',
        message: 'Daily bread means daily dependence.',
        sections: { heart: 'I would rather have a year of manna in the cupboard.' },
      },
    ];

    const created = [];
    for (const draft of drafts) {
      const conversation = await post('/api/conversations', {
        title: draft.title,
        scriptureReference: draft.scriptureReference,
      });
      await post(`/api/conversations/${conversation.id}/messages`, { content: draft.message });
      for (const [type, content] of Object.entries(draft.sections)) {
        await patch(`/api/conversations/${conversation.id}/sections`, { type, content });
      }
      created.push(conversation.id);
    }
    // One shared reflection, so the page shows both share states.
    const share = await post(`/api/conversations/${created[1]}/share`);
    return { created: created.length, shared: share.visibility ?? share.error };
  });
  console.log('seeded', seeded);

  /* --- populated --------------------------------------------------------- */

  await driver.navigate().refresh();
  await driver.wait(until.elementLocated(By.css('[data-view]')), 10000);
  await wait(900);
  const titles = await driver.executeScript(
    "return [...document.querySelectorAll('h3')].map((h) => h.innerText)",
  );
  console.log('tiles rendered:', titles.length, titles);
  const sections = await driver.executeScript(
    "return [...document.querySelectorAll('main h2')].map((h) => h.innerText)",
  );
  console.log('sections:', sections);
  const progress = await driver.executeScript(
    "return [...document.querySelectorAll('[role=img][aria-label^=\"C.H.A.T.\"]')].map((n) => n.getAttribute('aria-label'))",
  );
  console.log('C.H.A.T. accessible names:', progress);
  await shot(driver, 'reflections-populated-1280');

  /* --- THE PROOF: columns follow the container, not the viewport --------- */

  console.log('\ncontainer-query proof — viewport held at', await driver.executeScript('return window.innerWidth'), 'px');
  const measurements = await driver.executeScript(async () => {
    const page = document.querySelector('[data-reflections-root]');
    const host = page.parentElement; // the shell's <main>, i.e. the space the page is given
    const original = host.style.width;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = [];
    for (const width of [1180, 1000, 900, 860, 700, 560, 520, 420]) {
      host.style.width = `${width}px`;
      await frame();
      const grid = document.querySelector('[data-grid="tiles"]');
      out.push({
        requested: width,
        containerWidth: Math.round(page.getBoundingClientRect().width),
        viewportWidth: window.innerWidth,
        gridTemplateColumns: getComputedStyle(grid).gridTemplateColumns,
      });
    }
    host.style.width = original;
    await frame();
    return out;
  });
  for (const row of measurements) {
    console.log(
      `  container ${String(row.containerWidth).padStart(4)}px · viewport ${row.viewportWidth}px · ` +
        `${columns(row.gridTemplateColumns)} column(s)  [${row.gridTemplateColumns}]`,
    );
  }

  // Squeezed to a compact container, at a desktop viewport, and screenshotted.
  await driver.executeScript(
    "document.querySelector('[data-reflections-root]').parentElement.style.width = '500px'",
  );
  await wait(400);
  await shot(driver, 'reflections-container-500-at-viewport-1280');
  await driver.executeScript(
    "document.querySelector('[data-reflections-root]').parentElement.style.width = ''",
  );

  /* --- the control bar sticks *below* the shell header ------------------- */

  // A short window, so there is genuinely something to scroll past.
  await driver.manage().window().setRect({ width: 1280, height: 560 });
  await wait(400);
  await driver.executeScript('window.scrollTo(0, 600)');
  await wait(400);
  const sticky = await driver.executeScript(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    const controls = document
      .querySelector('#reflections-search')
      .closest('div').parentElement.getBoundingClientRect();
    return {
      scrollY: Math.round(window.scrollY),
      headerBottom: Math.round(header.bottom),
      controlsTop: Math.round(controls.top),
    };
  });
  console.log('\nscrolled', sticky.scrollY, 'px — header bottom', sticky.headerBottom, 'px, control bar top', sticky.controlsTop, 'px');
  console.log('  control bar clears the header:', sticky.controlsTop >= sticky.headerBottom);
  await shot(driver, 'reflections-scrolled-1280');
  await driver.executeScript('window.scrollTo(0, 0)');
  await driver.manage().window().setRect({ width: 1280, height: 1000 });
  await wait(400);

  /* --- search, filters, display control --------------------------------- */

  const search = await driver.findElement(By.css('#reflections-search'));
  console.log('\nsearch placeholder:', JSON.stringify(await search.getAttribute('placeholder')));
  await search.sendKeys('stillness');
  await wait(700);
  console.log(
    'results for "stillness":',
    await driver.executeScript("return [...document.querySelectorAll('h3')].map((h) => h.innerText)"),
  );
  await clearField(search);
  await search.sendKeys('z');
  await wait(700);
  const noMatch = await driver.executeScript(
    "return document.querySelector('main').innerText.includes('Nothing matches')",
  );
  console.log('no-match message shown, empty state not hijacked:', noMatch);
  await clearField(search);
  await wait(700);

  for (const label of ['List', 'Tiles', 'Auto']) {
    for (const button of await driver.findElements(By.css('button'))) {
      if ((await button.getText()) === label) {
        await button.click();
        break;
      }
    }
    await wait(300);
    const stored = await driver.executeScript(
      "return window.localStorage.getItem('chat.reflections.display')",
    );
    const view = await driver.executeScript(
      "return document.querySelector('[data-view]')?.getAttribute('data-view')",
    );
    console.log(`  ${label} → stored ${JSON.stringify(stored)}, rendered ${JSON.stringify(view)}`);
    if (label === 'List') await shot(driver, 'reflections-list-1280');
  }

  /* --- narrow viewport --------------------------------------------------- */

  await driver.manage().window().setRect({ width: 390, height: 900 });
  await wait(600);
  const narrow = await driver.executeScript(() => {
    const grid = document.querySelector('[data-grid="tiles"]');
    const page = document.querySelector('[data-reflections-root]');
    return {
      viewportWidth: window.innerWidth,
      containerWidth: Math.round(page.getBoundingClientRect().width),
      gridTemplateColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log('\n390px:', narrow, `→ ${columns(narrow.gridTemplateColumns)} column(s)`);
  await shot(driver, 'reflections-390');

  /* --- console ----------------------------------------------------------- */

  const severe = (await driver.manage().logs().get('browser')).filter(
    (entry) =>
      entry.level.name === 'SEVERE' &&
      !/favicon/.test(entry.message) &&
      !/auth\/me/.test(entry.message),
  );
  console.log('\nconsole SEVERE (excluding the expected pre-sign-in 401):');
  console.log(severe.length ? severe.map((e) => e.message).join('\n') : '  clean');
} finally {
  await driver.quit();
}
