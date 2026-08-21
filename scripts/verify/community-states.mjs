/*
 * Community, in each of the states it actually has.
 *
 * A feed with nothing in it passes every check and proves nothing, and most of
 * what can go wrong here is about *who is looking*: a guest, a member, someone
 * who has asked and is waiting, someone who has not asked yet. So this builds
 * the situations through the API — the real endpoints, with the real rules —
 * and then photographs the screen for each one.
 *
 * Nothing here relaxes a membership or reporting rule to make a picture
 * easier to take. Where a state cannot be reached honestly it is reported as
 * not reached rather than faked.
 */
import { newDriver, capture, report, wait, emulateDark } from './lib/viewport.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname;
const label = process.argv[2] ?? 'com';
const vp = { width: 390, height: 844 };

/** Runs in the page: builds owners, communities and publications. */
const BUILD = `
  const post = (p, b) => fetch(p, { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.text() }));
  const patch = (p, b) => fetch(p, { method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
  const json = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

  return (async () => {
    const stamp = String(SEED);
    const complete = async (title, reference) => {
      const made = json(await post('/api/conversations', { title, scriptureReference: reference }));
      for (const [type, content] of Object.entries({
        content: reference + ' — the passage this was written against.',
        heart: 'It met a fear I had not said out loud until I wrote it down here.',
        application: 'I will pray before I react this week, rather than after it has gone wrong.',
        testimony: 'He kept me awake for this one, and I am glad that he did.',
      })) await patch('/api/conversations/' + made.id + '/sections', { type, content });
      return made.id;
    };

    /* The owner: two communities and two publications. */
    await post('/api/auth/register', { email: 'owner' + stamp + '@example.com', password: 'secret12' });
    const open = json(await post('/api/communities', {
      name: 'Morning Readers', description: 'Reading together before the day starts.', preset: 'public' }));
    const closed = json(await post('/api/communities', {
      name: 'Quiet Circle', description: 'A small group that reads slowly.', preset: 'private' }));
    const spare = json(await post('/api/communities', {
      name: 'Evening Psalms', description: 'A psalm at the end of the day.', preset: 'private' }));

    const publicOne = await complete('The comfort and home of God\\u2019s love', 'John 3:16');
    const publicPub = json(await post('/api/publications', { conversationId: publicOne, audience: 'public' }));

    const memberOnly = await complete('Only for the circle', 'Psalm 23:1');
    const memberPub = json(await post('/api/publications', {
      conversationId: memberOnly, audience: 'community', communityId: closed.id }));

    await post('/api/auth/logout');

    /* The viewer: a member of one, waiting on another, and eligible for a third. */
    await post('/api/auth/register', { email: 'viewer' + stamp + '@example.com', password: 'secret12' });
    const joined = json(await post('/api/communities/' + open.id + '/join'));
    const requested = json(await post('/api/communities/' + closed.id + '/join'));

    return JSON.stringify({
      openId: open.id, closedId: closed.id, spareId: spare.id,
      publicPubId: publicPub && publicPub.id, memberPubId: memberPub && memberPub.id,
      joinedState: joined && joined.state, requestedState: requested && requested.state,
    });
  })();
`;

const shot = async (d, name, dark = false) =>
  report(`${label}-${name}${dark ? '-dark' : ''}`, await capture(d, {
    ...vp, out: OUT, name: `${label}-${name}${dark ? '-dark' : ''}`, dark,
  }));

const tab = (name) => `
  const t = [...document.querySelectorAll('[role=tab]')].find(
    (x) => x.textContent.trim() === ${JSON.stringify(name)});
  if (!t) return 'no tab ' + ${JSON.stringify(name)};
  t.click(); return 'ok';
`;

let fixture;
{
  const d = await newDriver(vp);
  try {
    await d.get(WEB);
    await wait(1600);
    fixture = JSON.parse(await d.executeScript(`const SEED = ${Date.now()};\n${BUILD}`));
    console.log('  fixture:', JSON.stringify(fixture));

    /* --- as the registered viewer ------------------------------------- */
    await d.get(`${WEB}/community`);
    await wait(2400);
    await d.executeScript(tab('Public'));
    await wait(1800);
    await shot(d, 'public-registered');

    await d.executeScript(tab('Communities'));
    await wait(1800);
    await shot(d, 'memberships-joined');

    /*
     * Requested and eligible live behind Browse — the directory, rather than
     * the list of what you are already in.
     */
    const browsed = await d.executeScript(`
      const b = [...document.querySelectorAll('button, a')].find(
        (x) => x.textContent.trim() === 'Browse');
      if (!b) return 'no Browse control';
      b.click(); return 'ok';
    `);
    if (browsed !== 'ok') console.log('  browse:', browsed);
    await wait(2000);
    await shot(d, 'memberships-browse');

    /* Member-only content, by its own address, to somebody outside it. */
    if (fixture.memberPubId) {
      await d.get(`${WEB}/community/publications/${fixture.memberPubId}`);
      await wait(2200);
      await shot(d, 'member-only-denied');
    }

    /* The named community's own page. */
    await d.get(`${WEB}/community?community=${fixture.openId}`);
    await wait(2200);
    await shot(d, 'named-community');
  } finally {
    await d.quit();
  }
}

/* --- as a guest ------------------------------------------------------- */
{
  const d = await newDriver(vp);
  try {
    await d.get(WEB);
    await wait(1600);
    await d.executeScript(`
      return fetch('/api/auth/guest', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creationSource: 'REFLECTION_CREATE' }) }).then((r) => r.status);
    `);
    await d.get(`${WEB}/community`);
    await wait(2400);
    await shot(d, 'public-guest');
    await shot(d, 'public-guest', false);

    /* A guest reading one public reflection all the way through. */
    if (fixture.publicPubId) {
      await d.get(`${WEB}/community/publications/${fixture.publicPubId}`);
      await wait(2200);
      await shot(d, 'guest-reads-public');
    }

    /* And refused the member-only one, with the reason a guest should get. */
    if (fixture.memberPubId) {
      await d.get(`${WEB}/community/publications/${fixture.memberPubId}`);
      await wait(2200);
      await shot(d, 'guest-member-only-denied');
    }
  } finally {
    await d.quit();
  }
}
