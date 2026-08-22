/*
 * Whether a domain takes mail, and the difference between "no" and "cannot say".
 *
 * Treating a timeout as a bad domain would refuse real people whenever DNS
 * hiccupped — and then remember the refusal, which is worse.
 */
import { expect, test } from 'vitest';
import { MailDomainCheck, type MailDomainResolver } from './mail-domain.ts';

const fail = (code: string) => {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
};

function resolver(over: Partial<MailDomainResolver> = {}): MailDomainResolver {
  return {
    resolveMx: () => Promise.resolve([{ exchange: 'mx.example.com', priority: 10 }]),
    resolveAddress: () => Promise.resolve(['203.0.113.1']),
    ...over,
  };
}

test('a domain with MX records is deliverable', async () => {
  expect(await new MailDomainCheck(resolver()).check('example.com')).toBe('deliverable');
});

test('a domain with no MX but an address record still takes mail', async () => {
  const check = new MailDomainCheck(
    resolver({ resolveMx: () => Promise.resolve([]) }),
  );
  /* The RFC fallback, read conservatively: refusing here refuses a real domain. */
  expect(await check.check('example.com')).toBe('deliverable');
});

test('a domain that does not exist is undeliverable', async () => {
  const check = new MailDomainCheck(
    resolver({
      resolveMx: () => Promise.reject(fail('ENOTFOUND')),
      resolveAddress: () => Promise.reject(fail('ENOTFOUND')),
    }),
  );
  expect(await check.check('nope.invalid')).toBe('undeliverable');
});

test('a temporary resolver failure is not a verdict about the domain', async () => {
  const check = new MailDomainCheck(
    resolver({ resolveMx: () => Promise.reject(fail('ETIMEOUT')) }),
  );
  expect(await check.check('example.com')).toBe('unavailable');
});

test('an unrecognised resolver error is treated as temporary, not as a refusal', async () => {
  const check = new MailDomainCheck(
    resolver({ resolveMx: () => Promise.reject(fail('ESOMETHINGNEW')) }),
  );
  /* Wrong in the safe direction: a real person is delayed rather than refused. */
  expect(await check.check('example.com')).toBe('unavailable');
});

test('a decision is cached; weather is not', async () => {
  let mxCalls = 0;
  const check = new MailDomainCheck(
    resolver({
      resolveMx: () => {
        mxCalls += 1;
        return Promise.resolve([{ exchange: 'mx.example.com', priority: 10 }]);
      },
    }),
  );
  await check.check('example.com');
  await check.check('example.com');
  expect(mxCalls).toBe(1);

  let flakyCalls = 0;
  const flaky = new MailDomainCheck(
    resolver({
      resolveMx: () => {
        flakyCalls += 1;
        return Promise.reject(fail('ETIMEOUT'));
      },
      resolveAddress: () => Promise.reject(fail('ETIMEOUT')),
    }),
  );
  await flaky.check('example.com');
  await flaky.check('example.com');
  /*
   * Asked again: one bad minute for the resolver must not become hours of
   * refusing a domain that was fine all along.
   */
  expect(flakyCalls).toBe(2);
});

test('a cached decision expires', async () => {
  let calls = 0;
  let clock = 1_000;
  const check = new MailDomainCheck(
    resolver({
      resolveMx: () => {
        calls += 1;
        return Promise.resolve([{ exchange: 'mx.example.com', priority: 10 }]);
      },
    }),
    { ttlMs: 500, now: () => clock },
  );
  await check.check('example.com');
  clock += 600;
  await check.check('example.com');
  expect(calls).toBe(2);
});
