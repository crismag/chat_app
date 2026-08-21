/*
 * The very first visit, from a browser that has never been here.
 *
 * Every other check in this directory seeds a session first, which is exactly
 * how a login wall in front of public content survives a test suite: the
 * suite always arrives already known. This one arrives on a link, with no
 * cookie, no localStorage and no sessionStorage, the way a person following a
 * shared reflection does.
 *
 * A fresh browser per case, because the cheapest way to be sure nothing is
 * carried over is to have nothing to carry.
 */
import { newDriver, capture, report, wait } from './lib/viewport.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname;
const vp = { width: 390, height: 844 };

/** Build something public to arrive at, in a browser we then throw away. */
async function publishSomethingPublic() {
  const d = await newDriver(vp);
  try {
    await d.get(WEB);
    await wait(1600);
    return JSON.parse(
      await d.executeScript(`
        const post = (p, b) => fetch(p, { method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
          .then(async (r) => ({ status: r.status, body: await r.text() }));
        const patch = (p, b) => fetch(p, { method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
        return (async () => {
          const stamp = Date.now();
          await post('/api/auth/register', { email: 'first' + stamp + '@example.com', password: 'secret12' });
          await post('/api/communities', {
            name: 'Morning Readers', description: 'Reading together.', preset: 'public' });
          const made = JSON.parse((await post('/api/conversations', {
            title: 'A reflection anybody may read', scriptureReference: 'John 3:16' })).body);
          for (const [type, content] of Object.entries({
            content: 'John 3:16 — the passage this was written against.',
            heart: 'It met a fear I had not said out loud until I wrote it down.',
            application: 'I will pray before I react this week.',
            testimony: 'He kept me awake for this one.',
          })) await patch('/api/conversations/' + made.id + '/sections', { type, content });
          const pub = JSON.parse((await post('/api/publications', {
            conversationId: made.id, audience: 'public' })).body);
          return JSON.stringify({ publicationId: pub.id });
        })();
      `),
    );
  } finally {
    await d.quit();
  }
}

/** Prove the context really is empty before asking anything of it. */
const EMPTY = `
  return JSON.stringify({
    cookies: document.cookie,
    localStorage: Object.keys(localStorage).length,
    sessionStorage: Object.keys(sessionStorage).length,
  });
`;

const STATE = `
  const text = document.body.innerText;
  return JSON.stringify({
    path: location.pathname,
    /* The words that would mean a wall, a loop, or a lie about the session. */
    saysSignedOut: /no longer signed in|sign in again/i.test(text),
    saysSignIn: /^\\s*sign in\\s*$/im.test(text),
    /* And a cookie appearing would mean an account was made just for reading. */
    cookies: document.cookie,
    headings: [...document.querySelectorAll('h1, h2, h3')].map((h) => h.textContent.trim().slice(0, 40)),
    bodyStart: text.replace(/\\s+/g, ' ').slice(0, 110),
  });
`;

const { publicationId } = await publishSomethingPublic();

const cases = [
  ['a public reflection by its own address', `/community/publications/${publicationId}`],
  ['the Public community feed', '/community'],
  ['the discoverable community list', '/community'],
];

let failures = 0;
for (const [label, path] of cases) {
  const d = await newDriver(vp);
  try {
    /* Land on the address directly, the way a forwarded link does. */
    await d.get(`${WEB}${path}`);
    const before = JSON.parse(await d.executeScript(EMPTY));
    if (before.cookies || before.localStorage || before.sessionStorage) {
      console.log(`  ${label}: context was NOT clean — ${JSON.stringify(before)}`);
      failures += 1;
    }
    await wait(2800);

    if (label.startsWith('the discoverable')) {
      await d.executeScript(`
        const t = [...document.querySelectorAll('[role=tab]')].find(
          (x) => x.textContent.trim() === 'Communities');
        if (t) t.click();
      `);
      await wait(1600);
    }

    const seen = JSON.parse(await d.executeScript(STATE));
    const walled = seen.saysSignedOut;
    if (walled) failures += 1;
    console.log(`\n  ${label}`);
    console.log(`    started clean: cookies="${before.cookies}" local=${before.localStorage} session=${before.sessionStorage}`);
    console.log(`    landed on: ${seen.path}`);
    console.log(`    says signed out / sign in again: ${seen.saysSignedOut ? 'YES — WALL' : 'no'}`);
    console.log(`    a session was created just by reading: ${seen.cookies ? 'YES' : 'no'}`);
    console.log(`    content: ${seen.bodyStart}`);

    const name = `first-visit-${label.replace(/[^a-z]+/gi, '-').slice(0, 28)}`;
    report(name, await capture(d, { ...vp, out: OUT, name }));
  } catch (error) {
    failures += 1;
    console.log(`  ${label}: ${error.message}`);
  } finally {
    await d.quit();
  }
}

console.log(`\n  ${cases.length - failures}/${cases.length} first visits load public content without a wall`);
