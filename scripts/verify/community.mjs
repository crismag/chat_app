/*
 * Community — driven for real against the running dev servers.
 *
 * ── What this checks, and why it is not a unit test ────────────────────────
 *
 * The unit suite already proves the visibility predicate in isolation. What it
 * cannot prove is that the *deployed* arrangement — a real session cookie, the
 * real router, the real serialiser — keeps the same promises. So every
 * authorisation claim below is asserted on the **API payload a real browser
 * session receives**, fetched from inside that session with `credentials:
 * 'include'`, and never on rendered text.
 *
 * Rendering is checked too, but only as a second opinion: a component that got
 * hold of something another way would show up in the page text. If the two ever
 * disagree, believe the payload.
 *
 * ── The claims ────────────────────────────────────────────────────────────
 *
 *  1. A member sees a community publication; a non-member gets 404 on the very
 *     same URL, and the 404 body names nothing.
 *  2. A removed member loses access immediately — same URL, next request.
 *  3. A private reflection never appears in any Community response, in any
 *     scope, for anyone.
 *  4. Encouraged is one per user, and pressing it twice does not make it two.
 *  5. Save is invisible to the author: no count in any payload they receive.
 *  6. A public link works for a stranger, while a community publication offers
 *     no external share control at all — no flag, and no URL to render.
 *
 * Three browser sessions, because a cookie is the thing being tested and
 * swapping one out would not be the same test.
 *
 * Run with the dev servers up:  node scripts/verify/community.mjs
 */

import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const APP = 'http://localhost:5173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const shot = async (driver, name) => {
  writeFileSync(new URL(`${name}.png`, OUT), await driver.takeScreenshot(), 'base64');
  console.log(`  saved ${name}.png`);
};

const newDriver = async (width = 1280) =>
  new Builder()
    .forBrowser('chrome')
    .setChromeOptions(
      new chrome.Options().addArguments(
        '--headless=new',
        '--no-sandbox',
        `--window-size=${width},1200`,
      ),
    )
    .build();

/** Register through the real form, so the session cookie is the real one. */
const register = async (driver, email) => {
  await driver.get(`${APP}/login`);
  await driver.wait(until.elementLocated(By.css('#email')), 15000);
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
  await driver.wait(async () => !(await driver.getCurrentUrl()).includes('/login'), 15000);
  console.log(`registered ${email}`);
};

/**
 * Call the API inside a browser session.
 *
 * This is the whole point of the script: the request carries the session cookie
 * the browser actually holds, so what comes back is what that person's browser
 * would receive — not what a hand-built request from Node would.
 */
const call = (driver, method, path, body) =>
  driver.executeScript(
    async (m, p, b) =>
      fetch(p, {
        method: m,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...(b === null ? {} : { body: JSON.stringify(b) }),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    method,
    path,
    body ?? null,
  );

const PRIVATE_TITLE = 'PRIVATE-NEVER-SHARED';
const PRIVATE_BODY = 'PRIVATE-BODY-no-community-response-may-carry-this';
const COMMUNITY_TITLE = 'COMMUNITY-ONLY-Trusting-while-I-cannot-see';
const COMMUNITY_BODY = 'COMMUNITY-BODY-only-members-of-this-circle-may-read-this';
const PUBLIC_TITLE = 'PUBLIC-Be-still-and-know';

/** Write a complete Full C.H.A.T. so it passes the publication gate. */
const writeReflection = async (driver, title, reference, marker) =>
  driver.executeScript(
    async (t, ref, body) => {
      const post = (path, payload, method = 'POST') =>
        fetch(path, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then((r) => r.json());

      const created = await post('/api/conversations', {
        title: t,
        scriptureReference: ref,
      });
      const sections = {
        content: `Paul writes to a church under real pressure. ${body}`,
        heart: `This met my fear that uncertainty means God has stopped working. ${body}`,
        application: 'I will choose to pray before reacting this week.',
        testimony: 'I believe he is working even where I cannot see the shape of it.',
      };
      for (const [type, content] of Object.entries(sections)) {
        await post(`/api/conversations/${created.id}/sections`, { type, content }, 'PATCH');
      }
      return created.id;
    },
    title,
    reference,
    marker,
  );

const author = await newDriver();
const member = await newDriver();
const stranger = await newDriver();
let narrow = null;

try {
  const stamp = Date.now();
  const authorEmail = `author${stamp}@example.com`;
  const memberEmail = `member${stamp}@example.com`;
  const strangerEmail = `stranger${stamp}@example.com`;

  await register(author, authorEmail);
  await register(member, memberEmail);
  await register(stranger, strangerEmail);

  /* --- one community, one member ------------------------------------- */

  console.log('\nsetting up a community');
  const created = await call(author, 'POST', '/api/communities', {
    name: 'Christlikeness',
    description: 'A small circle reading together.',
  });
  const communityId = created.body.id;
  check('a community is created with its maker as owner', created.status === 201);

  const invited = await call(
    author,
    'POST',
    `/api/communities/${communityId}/invitations`,
    { email: memberEmail },
  );
  check('the owner may invite by email', invited.status === 201);

  const accepted = await call(
    member,
    'POST',
    `/api/communities/${communityId}/invitations/accept`,
  );
  check('the invited person may accept', accepted.status === 200);

  /* --- three reflections: private, community, public ------------------ */

  console.log('\nwriting and sharing');
  await writeReflection(author, PRIVATE_TITLE, 'Job 1:21', PRIVATE_BODY);

  const communitySource = await writeReflection(
    author,
    COMMUNITY_TITLE,
    'Romans 8:28',
    COMMUNITY_BODY,
  );
  const communityPub = await call(author, 'POST', '/api/publications', {
    conversationId: communitySource,
    audience: 'community',
    communityId,
    caption: 'Something I keep coming back to, for us.',
    hashtags: ['#young-adults', '#faith'],
  });
  check('a reflection is shared to one community', communityPub.status === 201);
  const communityPubId = communityPub.body.id;

  const publicSource = await writeReflection(author, PUBLIC_TITLE, 'Psalm 46:10', 'public');
  const publicPub = await call(author, 'POST', '/api/publications', {
    conversationId: publicSource,
    audience: 'public',
    caption: 'For anyone who needs it.',
    hashtags: ['#prayer'],
  });
  check('a reflection is shared publicly', publicPub.status === 201);
  const publicPubId = publicPub.body.id;

  const url = `/api/publications/${communityPubId}`;

  /* --- 1. a member sees it; a non-member 404s on the same URL --------- */

  console.log('\nmembership decides access');
  const asMember = await call(member, 'GET', url);
  check(
    'a member receives the community publication',
    asMember.status === 200 && asMember.body?.title === COMMUNITY_TITLE,
    `status ${asMember.status}`,
  );

  const asStranger = await call(stranger, 'GET', url);
  const strangerText = JSON.stringify(asStranger.body ?? {});
  check(
    'a non-member gets 404 on the same URL',
    asStranger.status === 404,
    `status ${asStranger.status}`,
  );
  check(
    'the 404 body names nothing — no title, no body, no community',
    !strangerText.includes(COMMUNITY_TITLE) &&
      !strangerText.includes(COMMUNITY_BODY) &&
      !strangerText.includes('Christlikeness'),
  );

  /* --- 3. a private reflection is in no Community response ------------ */

  console.log('\nnothing leaks through feeds, counts or suggestions');
  let privateLeaked = false;
  let communityLeakedToStranger = false;
  for (const [who, driver] of [
    ['author', author],
    ['member', member],
    ['stranger', stranger],
  ]) {
    for (const scope of ['shared', 'public', 'mine']) {
      for (const query of ['', `&q=${encodeURIComponent('PRIVATE')}`, '&q=uncertainty']) {
        const feed = await call(driver, 'GET', `/api/publications?scope=${scope}${query}`);
        const text = JSON.stringify(feed.body ?? {});
        if (text.includes(PRIVATE_TITLE) || text.includes(PRIVATE_BODY)) {
          privateLeaked = true;
          console.log(`    leaked to ${who} in ${scope}${query}`);
        }
        if (who === 'stranger' && (text.includes(COMMUNITY_TITLE) || text.includes(COMMUNITY_BODY))) {
          communityLeakedToStranger = true;
          console.log(`    community content leaked to a stranger in ${scope}${query}`);
        }
      }
    }
  }
  check('a private reflection appears in no Community response, for anyone', !privateLeaked);
  check(
    'community content never reaches a non-member, through any scope or search',
    !communityLeakedToStranger,
  );

  const strangerTags = await call(stranger, 'GET', '/api/publications?scope=shared');
  check(
    'tag chips never advertise a tag a non-member cannot reach',
    !JSON.stringify(strangerTags.body?.hashtags ?? []).includes('youngadults'),
  );

  /* --- 4. Encouraged is one per user ---------------------------------- */

  console.log('\nEncouraged, and Save');
  await call(member, 'POST', `${url}/encouraged`, { encouraged: true });
  const twice = await call(member, 'POST', `${url}/encouraged`, { encouraged: true });
  check(
    'Encouraged twice by one person is still one',
    twice.body?.encouraged?.count === 1,
    `count ${twice.body?.encouraged?.count}`,
  );
  const removed = await call(member, 'POST', `${url}/encouraged`, { encouraged: false });
  check(
    'Encouraged is removable',
    removed.body?.encouraged?.count === 0 && removed.body?.encouraged?.byViewer === false,
  );
  /* Put it back, so the screenshots show the state a reader would see. */
  await call(member, 'POST', `${url}/encouraged`, { encouraged: true });

  /* --- 5. Save is invisible to the author ----------------------------- */

  const saved = await call(member, 'POST', `${url}/save`, { saved: true });
  check('a member may save privately', saved.body?.saved === true);

  const authorView = await call(author, 'GET', url);
  const authorFeed = await call(author, 'GET', '/api/publications?scope=shared');
  const authorPayloads = JSON.stringify([authorView.body, authorFeed.body]);
  check(
    'the author is told nothing about saves — no count, no names, no key',
    authorView.body?.saved === false &&
      !/save(count|s|d?by)/i.test(authorPayloads) &&
      !authorPayloads.includes(memberEmail),
    `author's own saved flag: ${authorView.body?.saved}`,
  );

  /* --- 6. external sharing, by ownership ------------------------------ */

  console.log('\nexternal sharing');
  const memberView = await call(member, 'GET', url);
  check(
    "another member's community publication offers no external share control",
    memberView.body?.canShareExternally === false,
  );
  check(
    'and carries no share URL at all — nothing for a component to render',
    !Object.prototype.hasOwnProperty.call(memberView.body ?? {}, 'shareUrl'),
  );

  const publicToStranger = await call(stranger, 'GET', `/api/publications/${publicPubId}`);
  check(
    'a public link works for someone with no relationship to the author',
    publicToStranger.status === 200 && publicToStranger.body?.title === PUBLIC_TITLE,
    `status ${publicToStranger.status}`,
  );
  check(
    'and it carries a link they may share on',
    typeof publicToStranger.body?.shareUrl === 'string' &&
      publicToStranger.body.shareUrl.includes(publicPubId),
  );

  /* --- the pictures, taken while the member still has access ---------- */

  console.log('\nscreenshots');
  await member.get(`${APP}/community`);
  await member.wait(until.elementLocated(By.css('[role=tablist]')), 15000);
  await wait(1200);
  await shot(member, 'community-1280-shared');

  const rendered = await member.findElement(By.css('body')).getText();
  check(
    'the member reads the community publication on the page, not only in the payload',
    rendered.includes('Trusting while I cannot see') || rendered.includes(COMMUNITY_TITLE),
  );
  check(
    'and the page never shows the private reflection',
    !rendered.includes(PRIVATE_TITLE) && !rendered.includes(PRIVATE_BODY),
  );
  check(
    'no "For You" destination exists',
    !/for you/i.test(rendered),
  );

  await member.get(`${APP}/community/publications/${communityPubId}`);
  await wait(1200);
  await shot(member, 'community-1280-publication');

  const detail = await member.findElement(By.css('body')).getText();
  check(
    "a member's detail view carries no Share control",
    !/copy public link/i.test(detail),
  );

  await member.get(`${APP}/community`);
  await wait(600);
  await member.findElements(By.css('[role=tab]')).then(async (tabs) => {
    for (const tab of tabs) {
      if ((await tab.getText()) === 'Communities') await tab.click();
    }
  });
  await wait(1000);
  await shot(member, 'community-1280-communities');

  /* An empty Community, which is what most people see first. */
  await stranger.get(`${APP}/community`);
  await wait(1500);
  await shot(stranger, 'community-1280-empty');
  const emptyText = await stranger.findElement(By.css('body')).getText();
  check(
    'an empty Community is written, not "No posts."',
    /nothing has been shared with you yet/i.test(emptyText) && !/^no posts\.?$/im.test(emptyText),
  );

  /* The unknown URL, which used to be a blank white page. */
  await stranger.get(`${APP}/nope`);
  await wait(900);
  const notFound = await stranger.findElement(By.css('body')).getText();
  check(
    'an unknown URL renders a way back rather than a blank page',
    /this page does not exist/i.test(notFound) && /Reflect/.test(notFound),
  );
  await shot(stranger, 'community-1280-not-found');

  /* 390, on the member's session, where the content is. */
  narrow = await newDriver(390);
  await register(narrow, `narrow${stamp}@example.com`);
  await call(author, 'POST', `/api/communities/${communityId}/invitations`, {
    email: `narrow${stamp}@example.com`,
  });
  await call(narrow, 'POST', `/api/communities/${communityId}/invitations/accept`);
  await narrow.get(`${APP}/community`);
  await wait(1800);
  await shot(narrow, 'community-390-shared');
  await narrow.get(`${APP}/community/publications/${communityPubId}`);
  await wait(1500);
  await shot(narrow, 'community-390-publication');

  /* --- 2. removal takes effect immediately, on the same URL ----------- */

  console.log('\nremoval');
  const roster = await call(author, 'GET', `/api/communities/${communityId}/members`);
  const subject = (roster.body ?? []).find((row) => row.handle?.startsWith('member'));
  const removedMember = await call(
    author,
    'PATCH',
    `/api/communities/${communityId}/members/${subject?.userId}`,
    { state: 'removed' },
  );
  check('an owner may remove a member', removedMember.status === 200);

  const afterRemoval = await call(member, 'GET', url);
  check(
    'a removed member loses access immediately — the same URL, the next request',
    afterRemoval.status === 404,
    `status ${afterRemoval.status}`,
  );

  const afterFeed = await call(member, 'GET', '/api/publications?scope=shared');
  check(
    'and the community publication is gone from their feed too',
    !JSON.stringify(afterFeed.body ?? {}).includes(COMMUNITY_TITLE),
  );

  const stillEncouraged = await call(member, 'POST', `${url}/encouraged`, { encouraged: false });
  check(
    'a removed member cannot even act on an id they wrote down',
    stillEncouraged.status === 404,
    `status ${stillEncouraged.status}`,
  );

  /* The page tells them, rather than showing a blank. */
  await member.get(`${APP}/community/publications/${communityPubId}`);
  await wait(1200);
  const goneText = await member.findElement(By.css('body')).getText();
  check(
    'the page explains the loss of access rather than going blank',
    /not available/i.test(goneText) && !goneText.includes(COMMUNITY_BODY),
  );
  await shot(member, 'community-1280-no-longer-authorised');
} finally {
  for (const driver of [author, member, stranger, narrow]) {
    if (driver) await driver.quit();
  }
  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed` +
      (failed.length ? `\nFAILED: ${failed.map((f) => f.name).join('; ')}` : ''),
  );
  process.exit(failed.length ? 1 : 0);
}
