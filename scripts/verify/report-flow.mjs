/*
 * Reporting, driven the way somebody reports.
 *
 * Every state here is reached by pressing what a person presses — the card's
 * overflow, a reason, Submit — rather than by rendering the dialog directly.
 * That is the point: the parts that go wrong are the joins between the card,
 * the form and the server, and a component test never crosses them.
 *
 * Nothing here relaxes a moderation rule. A report still does not hide
 * anything, and what the server does about duplicates is observed and
 * reported rather than adjusted to make a screenshot tidier.
 */
import { newDriver, capture, report, wait } from './lib/viewport.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname;
const vp = { width: 390, height: 844 };
const label = 'report';

const shot = async (d, name) =>
  report(`${label}-${name}`, await capture(d, { ...vp, out: OUT, name: `${label}-${name}` }));

/** Somebody else's public reflection, and a reader who is not its author. */
const SETUP = `
  const post = (p, b) => fetch(p, { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.text() }));
  const patch = (p, b) => fetch(p, { method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
  return (async () => {
    const stamp = Date.now();
    await post('/api/auth/register', { email: 'author' + stamp + '@example.com', password: 'secret12' });
    const made = JSON.parse((await post('/api/conversations', {
      title: 'A reflection somebody else wrote', scriptureReference: 'John 3:16' })).body);
    for (const [type, content] of Object.entries({
      content: 'John 3:16 — the passage this was written against.',
      heart: 'It met a fear I had not said out loud until I wrote it down here.',
      application: 'I will pray before I react this week.',
      testimony: 'He kept me awake for this one.',
    })) await patch('/api/conversations/' + made.id + '/sections', { type, content });
    const pub = JSON.parse((await post('/api/publications', {
      conversationId: made.id, audience: 'public' })).body);
    /*
     * The author stays signed in as themselves; everybody else is somebody
     * else. Logging out unconditionally is how the own-reflection case came
     * to be testing a stranger and reporting that Report was offered.
     */
    if (READER === 'author') return JSON.stringify({ publicationId: pub.id, stamp });
    await post('/api/auth/logout');
    if (READER === 'registered') {
      await post('/api/auth/register', { email: 'reader' + stamp + '@example.com', password: 'secret12' });
    } else if (READER === 'guest') {
      await post('/api/auth/guest', { creationSource: 'REFLECTION_CREATE' });
    }
    return JSON.stringify({ publicationId: pub.id, stamp });
  })();
`;

/*
 * The card's overflow names itself with a visually-hidden span rather than an
 * aria-label, so it is found by what it is — a menu trigger — rather than by
 * an attribute it does not carry.
 */
/*
 * The card's overflow names itself with a visually-hidden span rather than an
 * aria-label, so it is found by what it is — a menu trigger — and by being
 * visible, because the desktop header is still in the document at phone
 * widths and its account menu answers the same selector. Opening that one
 * instead is how this reported "no Report item" for several minutes.
 */
const openOverflow = `
  const trigger = [...document.querySelectorAll('[aria-haspopup="menu"][aria-expanded]')]
    .find((b) => b.getBoundingClientRect().width > 0);
  if (!trigger) return 'no overflow';
  trigger.click();
  return 'ok';
`;

const pressReport = `
  const item = [...document.querySelectorAll('[role=menuitem], button')].find(
    (b) => b.textContent.trim() === 'Report' && b.getBoundingClientRect().width > 0);
  if (!item) return 'no Report item';
  item.click();
  return 'ok';
`;

async function land(d, reader) {
  await d.get(WEB);
  await wait(1600);
  const fixture = JSON.parse(await d.executeScript(`const READER = ${JSON.stringify(reader)};\n${SETUP}`));
  await d.get(`${WEB}/community`);
  await wait(2400);
  await d.executeScript(`
    const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim() === 'Public');
    if (t) t.click();
  `);
  await wait(1800);
  return fixture;
}

const results = [];
const note = (what, detail) => {
  results.push(`  ${what.padEnd(42)} ${detail}`);
  console.log(`  ${what.padEnd(42)} ${detail}`);
};

/* --- a registered reader, reporting somebody else's reflection ---------- */
{
  const d = await newDriver(vp);
  try {
    const fixture = await land(d, 'registered');

    note('report action available', await d.executeScript(openOverflow));
    await wait(700);
    await shot(d, '1-action-available');

    note('report form opens', await d.executeScript(pressReport));
    await wait(900);
    await shot(d, '2-form-open');

    /* A category is required: Submit is refused until one is chosen. */
    note(
      'category required (submit disabled first)',
      await d.executeScript(`
        const b = [...document.querySelectorAll('button')].find((x) => /submit report/i.test(x.textContent));
        return b ? (b.disabled ? 'disabled until a reason is chosen' : 'ENABLED — not required') : 'no submit';
      `),
    );

    /* "Something else" needs a sentence — the validation case. */
    await d.executeScript(`
      const other = [...document.querySelectorAll('input[type=radio]')].pop();
      if (other) { other.click(); }
    `);
    await wait(500);
    note(
      'validation failure (reason needing detail)',
      await d.executeScript(`
        const b = [...document.querySelectorAll('button')].find((x) => /submit report/i.test(x.textContent));
        const hint = [...document.querySelectorAll('p')].find((p) => /needs a sentence/i.test(p.textContent));
        return (b && b.disabled ? 'submit refused' : 'submit allowed') + (hint ? ' + reason shown' : ' + NO reason shown');
      `),
    );
    await shot(d, '3-validation');

    /* The optional explanation, filled in. */
    await d.executeScript(`
      const area = document.querySelector('#report-note');
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(area, 'This repeats somebody else’s writing without saying so.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await wait(600);
    await shot(d, '4-explanation');

    /* A failure that can be recovered from, forced at the network. */
    await d.executeScript(`
      /* Bound, because an unbound fetch called off window throws Illegal invocation. */
      window.__realFetch = window.fetch.bind(window);
      window.fetch = (url, init) =>
        String(url).includes('/report')
          ? Promise.reject(new Error('The network dropped. Nothing was sent.'))
          : window.__realFetch(url, init);
    `);
    await d.executeScript(`
      [...document.querySelectorAll('button')].find((x) => /submit report/i.test(x.textContent))?.click();
    `);
    await wait(1200);
    note(
      'recoverable failure keeps the form',
      await d.executeScript(`
        const alert = document.querySelector('[role=alert]');
        const area = document.querySelector('#report-note');
        const checked = document.querySelector('input[type=radio]:checked');
        return (alert ? 'says why' : 'SILENT') +
          ' | note kept: ' + (area && area.value.length > 10) +
          ' | reason kept: ' + Boolean(checked);
      `),
    );
    await shot(d, '5-failure-recoverable');

    /* Restored, and sent for real. */
    await d.executeScript('window.fetch = window.__realFetch;');
    await d.executeScript(`
      [...document.querySelectorAll('button')].find((x) => /try again|submit report/i.test(x.textContent))?.click();
    `);
    await wait(1500);
    note(
      'successful report',
      await d.executeScript(`return document.body.innerText.includes('Report received.') ? 'confirmed' : 'NOT confirmed'`),
    );
    await shot(d, '6-sent');

    /* The same reader reporting the same thing again. */
    await d.executeScript(`
      [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Close')?.click();
    `);
    await wait(800);
    const again = await d.executeScript(`
      const id = ${JSON.stringify('PLACEHOLDER')};
      return (async () => {
        const r = await fetch('/api/publications/' + id + '/report', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'other', detail: 'The very same complaint, sent twice.' }),
        });
        return r.status + ' ' + (await r.text()).slice(0, 80);
      })();
    `.replace('PLACEHOLDER', fixture.publicationId));
    note('duplicate report (same reader, same thing)', String(again));
  } finally {
    await d.quit();
  }
}

/* --- the author, on their own reflection -------------------------------- */
{
  const d = await newDriver(vp);
  try {
    await d.get(WEB);
    await wait(1600);
    await d.executeScript(`const READER = 'author';\n${SETUP}`);
    /* Registered as the author still, because SETUP only logs out for others. */
    await d.get(`${WEB}/community`);
    await wait(2400);
    await d.executeScript(`
      const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim() === 'Public');
      if (t) t.click();
    `);
    await wait(1800);
    await d.executeScript(openOverflow);
    await wait(700);
    note(
      'own reflection: report offered?',
      await d.executeScript(`
        const item = [...document.querySelectorAll('[role=menuitem], button')].find(
          (b) => b.textContent.trim() === 'Report');
        return item ? 'OFFERED' : 'not offered (own reflection)';
      `),
    );
    await shot(d, '7-own-reflection');
  } finally {
    await d.quit();
  }
}

/* --- a guest -------------------------------------------------------------- */
{
  const d = await newDriver(vp);
  try {
    await land(d, 'guest');
    await d.executeScript(openOverflow);
    await wait(700);
    await d.executeScript(pressReport);
    await wait(1000);
    note(
      'guest reporting',
      await d.executeScript(`
        const text = document.body.innerText;
        return (text.includes('Create your profile') ? 'account sheet shown' : 'NO account sheet') +
          ' | report form open: ' + Boolean(document.querySelector('#report-note')) +
          ' | says signed out: ' + /no longer signed in|sign in again/i.test(text);
      `),
    );
    await shot(d, '8-guest');
  } finally {
    await d.quit();
  }
}

console.log('\n  report-flow evidence in scripts/verify/out/report-*.png');
