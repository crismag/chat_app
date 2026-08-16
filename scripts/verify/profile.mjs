/*
 * The public profile — driven for real, against the running dev servers.
 *
 * Four claims are checked here, and only one of them is a screenshot.
 *
 *  1. A profile renders as a portfolio: identity, favourite Scripture, and the
 *     person's published reflections as the same gallery cards Reflections uses.
 *  2. **A private reflection never appears on it.** Checked twice over: once by
 *     reading the API payload a *second* account receives — the assertion that
 *     matters, because it is upstream of any rendering — and once by searching
 *     the rendered page text, which would catch a component that somehow got
 *     hold of it another way.
 *  3. The limits are enforced by the server, not only by the form, so the
 *     script bypasses the inputs entirely and PATCHes over-long values.
 *  4. A taken handle is refused with a sentence a person can act on.
 *
 * Screenshots at 1280 and 390 are the last step, not the evidence.
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const clearField = async (element) => {
  await element.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE);
};

/** Register through the real form, so the session cookie is the real one. */
const register = async (driver, email) => {
  await driver.get(`${APP}/login`);
  await driver.wait(until.elementLocated(By.css('#email')), 10000);
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
  console.log(`registered ${email}`);
};

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--window-size=1280,1200'),
  )
  .build();

const PRIVATE_TITLE = 'PRIVATE-DO-NOT-SHOW';
const PRIVATE_BODY = 'PRIVATE-BODY-that-no-stranger-may-read';

try {
  /* --- the author, with one published and one private reflection ------- */

  const stamp = Date.now();
  const authorEmail = `author${stamp}@example.com`;
  await register(driver, authorEmail);

  const seeded = await driver.executeScript(
    async (privateTitle, privateBody) => {
      const call = (method, path, body) =>
        fetch(path, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

      const write = async (draft, publish) => {
        const created = await call('POST', '/api/conversations', {
          title: draft.title,
          scriptureReference: draft.reference,
        });
        const id = created.body.id;
        for (const [type, content] of Object.entries(draft.sections)) {
          await call('PATCH', `/api/conversations/${id}/sections`, { type, content });
        }
        if (publish) await call('POST', `/api/conversations/${id}/publish`);
        return id;
      };

      const published = [];
      published.push(
        await write(
          {
            title: 'Trusting while I cannot see',
            reference: 'Romans 8:28',
            sections: {
              content: 'Paul writes this to a church under real pressure, not a comfortable one.',
              heart: 'It met the part of me that wants the outcome before the obedience.',
              application: 'I will pray before I react to the letter that is coming this week.',
              testimony: 'God has not been absent in the months I could not read His hand.',
            },
          },
          true,
        ),
      );
      published.push(
        await write(
          {
            title: 'Be still and know',
            reference: 'Psalm 46:10',
            sections: {
              content: 'A psalm sung while the nations rage and the earth gives way.',
              heart: 'Being still is not doing nothing; it is refusing to panic.',
              application: 'Ten minutes before the phone tomorrow morning.',
              testimony: 'The day I stopped rehearsing the argument, it lost its grip.',
            },
          },
          true,
        ),
      );
      published.push(
        await write(
          {
            title: 'The vine and the branches',
            reference: 'John 15:5',
            sections: {
              content: 'Jesus speaks this on the last night, walking towards Gethsemane.',
              heart: 'I have been trying to produce what only abiding can grow.',
              application: 'One unhurried hour on Sunday, before anything is planned.',
              testimony: 'Fruit has come from the seasons I thought were fallow.',
            },
          },
          true,
        ),
      );

      const privateId = await write(
        {
          title: privateTitle,
          reference: 'Psalm 51:1',
          sections: { content: privateBody, heart: privateBody },
        },
        false,
      );

      const profile = await call('PATCH', '/api/profiles/me', {
        displayName: 'Cris Magalang',
        tagline: 'Reading slowly, on purpose — one passage at a time.',
        favouriteVerses: ['Romans 8:28', 'Psalm 46:10', 'John 15:5'],
      });

      return { published, privateId, handle: profile.body.handle };
    },
    PRIVATE_TITLE,
    PRIVATE_BODY,
  );

  console.log(`seeded ${seeded.published.length} published, 1 private, handle @${seeded.handle}`);

  /* --- reached from the shell's avatar menu, not only by URL ----------- */

  await driver.get(`${APP}/reflections`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await driver.findElement(By.css('header button[aria-haspopup=menu]')).click();
  await wait(300);
  let opened = false;
  for (const item of await driver.findElements(By.css('[role=menuitem]'))) {
    if ((await item.getText()).trim() === 'Your profile') {
      await item.click();
      opened = true;
      break;
    }
  }
  await wait(700);
  check(
    'the profile is reachable from the avatar menu',
    opened && (await driver.getCurrentUrl()).includes('/profile'),
    await driver.getCurrentUrl(),
  );

  /* --- the author's own profile ---------------------------------------- */

  await driver.get(`${APP}/profile`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await wait(600);
  const ownUrl = await driver.getCurrentUrl();
  check(
    '/profile resolves to the owner’s handle',
    ownUrl.endsWith(`/profile/${seeded.handle}`),
    ownUrl,
  );

  const ownText = await driver.executeScript("return document.querySelector('main').innerText");
  check('renders the display name', ownText.includes('Cris Magalang'));
  check('renders the handle', ownText.includes(`@${seeded.handle}`));
  check('renders the tagline', ownText.includes('Reading slowly, on purpose'));
  check(
    'renders up to three favourite Scripture references',
    ['Romans 8:28', 'Psalm 46:10', 'John 15:5'].every((verse) => ownText.includes(verse)),
  );
  check('renders the public C.H.A.T. count', ownText.includes('3 public C.H.A.T.s'));
  check('offers Edit profile on one’s own profile', ownText.includes('Edit profile'));
  check(
    'shows no empty future tabs',
    !/\b(Activity|Likes|Encouraged|Following|Followers|Subscriptions|Notes)\b/.test(ownText),
    'Activity · Likes · Encouraged · Following · Followers · Subscriptions · Notes',
  );
  check('shows no follower or following counts', !/follow/i.test(ownText));
  check(
    'shows no empty Communities shell',
    !/Communit/i.test(ownText),
    'omitted entirely rather than shown empty',
  );
  const disabled = await driver.findElements(By.css('main [disabled], main [aria-disabled=true]'));
  check('shows no disabled or placeholder controls', disabled.length === 0);

  /* --- the sharp edge: a stranger, and the payload they receive -------- */

  const strangerEmail = `stranger${stamp}@example.com`;
  await driver.executeScript(() =>
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }),
  );
  await register(driver, strangerEmail);

  const payload = await driver.executeScript(
    (handle) =>
      fetch(`/api/profiles/${handle}`, { credentials: 'include' }).then((r) => r.text()),
    seeded.handle,
  );

  check(
    'API payload contains no private title',
    !payload.includes(PRIVATE_TITLE),
    'asserted on the response body, not the rendering',
  );
  check('API payload contains no private section text', !payload.includes(PRIVATE_BODY));
  check('API payload contains no private Scripture reference', !payload.includes('Psalm 51:1'));
  check('API payload contains no private reflection id', !payload.includes(seeded.privateId));
  const parsed = JSON.parse(payload);
  check(
    'API payload counts only public C.H.A.T.s',
    parsed.publicChatCount === 3 && parsed.shares.length === 3,
    `count ${parsed.publicChatCount}, shares ${parsed.shares.length}`,
  );
  check('API payload carries no email or user id', !/@example\.com|userId/.test(payload));

  await driver.get(`${APP}/profile/${seeded.handle}`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await wait(600);
  const strangerText = await driver.executeScript(
    "return document.querySelector('main').innerText",
  );
  check('the rendered page shows no private reflection either', !strangerText.includes(PRIVATE_TITLE));
  check(
    'the rendered page shows the three public reflections',
    ['Trusting while I cannot see', 'Be still and know', 'The vine and the branches'].every((t) =>
      strangerText.includes(t),
    ),
  );
  check(
    'a stranger is offered Report profile and Block user',
    strangerText.includes('Report profile') && strangerText.includes('Block user'),
  );
  check(
    'a stranger cannot open the author’s reflections',
    (await driver.findElements(By.css('main a[href*="?c="]'))).length === 0,
  );
  await shot(driver, 'profile-1280-stranger');

  /* --- limits, enforced by the server rather than the form ------------- */

  const limits = await driver.executeScript(async () => {
    const patch = (body) =>
      fetch('/api/profiles/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

    return {
      displayName: await patch({ displayName: 'x'.repeat(51) }),
      tagline: await patch({ tagline: 'x'.repeat(161) }),
      verses: await patch({ favouriteVerses: ['a', 'b', 'c', 'd'] }),
      handleShort: await patch({ handle: 'ab' }),
      handleLong: await patch({ handle: 'a'.repeat(31) }),
      handleReserved: await patch({ handle: 'me' }),
    };
  });

  check('display name over 50 is refused by the server', limits.displayName.status === 400);
  check('tagline over 160 is refused by the server', limits.tagline.status === 400);
  check('a fourth favourite verse is refused by the server', limits.verses.status === 400);
  check('a handle under 3 characters is refused', limits.handleShort.status === 400);
  check('a handle over 30 characters is refused', limits.handleLong.status === 400);
  check('a reserved handle is refused', limits.handleReserved.status === 400);
  check(
    'each refusal says what to do',
    Object.values(limits).every((result) => /\d|handle/.test(result.body?.error ?? '')),
    limits.displayName.body?.error ?? '',
  );

  /* --- a taken handle, refused in the interface ------------------------ */

  await driver.get(`${APP}/profile`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await wait(500);
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).trim() === 'Edit profile') {
      await button.click();
      break;
    }
  }
  await wait(400);
  const handleInput = await driver.findElement(By.css('input[id$="-handle"]'));
  await clearField(handleInput);
  await handleInput.sendKeys(seeded.handle);
  await shot(driver, 'profile-1280-editor');
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).trim() === 'Save profile') {
      await button.click();
      break;
    }
  }
  await wait(800);
  const alert = await driver.findElements(By.css('[role=alert]'));
  const alertText = alert.length > 0 ? await alert[0].getText() : '';
  check(
    'a taken handle is refused in plain words',
    /already taken/i.test(alertText) && alertText.includes(`@${seeded.handle}`),
    alertText,
  );
  const invalid = await driver.findElements(By.css('input[aria-invalid=true]'));
  check('the refused field is marked, not only coloured', invalid.length === 1);
  await shot(driver, 'profile-1280-handle-taken');

  /* --- report, which must state that nothing is removed ---------------- */

  await driver.get(`${APP}/profile/${seeded.handle}`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await wait(500);
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).trim() === 'Report profile') {
      await button.click();
      break;
    }
  }
  await wait(400);
  const reportText = await driver.executeScript(
    "return document.querySelector('main').innerText",
  );
  check(
    'the report form says reporting removes nothing for others',
    /does not remove anything for other people/i.test(reportText),
  );
  await shot(driver, 'profile-1280-report');

  /* --- keyboard reachability ------------------------------------------- */

  await driver.get(`${APP}/profile/${seeded.handle}`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await wait(500);
  const reachable = await driver.executeScript(() => {
    const main = document.querySelector('main');
    const focusable = [...main.querySelectorAll('a[href], button, input, textarea, select')];
    return focusable.every((element) => element.tabIndex >= 0);
  });
  check('every control in the page is keyboard reachable', reachable === true);

  /* --- dark theme, and the phone -------------------------------------- */

  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await wait(300);
  await shot(driver, 'profile-1280-dark');
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', { features: [] });

  await driver.manage().window().setRect({ width: 390, height: 844 });
  await driver.get(`${APP}/profile/${seeded.handle}`);
  await driver.wait(until.elementLocated(By.css('h1')), 10000);
  await wait(700);
  const overflow = await driver.executeScript(
    'return document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  check('no horizontal overflow at 390px', overflow <= 0, `${overflow}px`);
  const columns = await driver.executeScript(() => {
    const grid = document.querySelector('main ul');
    return grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0;
  });
  check('one column at 390px', columns === 1, `${columns} column(s)`);
  await shot(driver, 'profile-390-stranger');

  console.log('');
  const failed = results.filter((result) => !result.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('failed:', failed.map((result) => result.name).join(' · '));
    process.exitCode = 1;
  }
} finally {
  await driver.quit();
}
