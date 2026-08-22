import { expect, test } from 'vitest';
import { LoggingMailer } from './mailer.ts';

test('an unconfigured mailer never writes a reset token to the log', async () => {
  const lines: string[] = [];
  const mailer = new LoggingMailer((line) => lines.push(line));
  await mailer.send({
    to: 'person@example.com',
    subject: 'Set a new C.H.A.T. password',
    text: 'Open this link:\nhttps://chat.example/reset-password?token=SUPERSECRETTOKENVALUE\n',
    html: '<a href="https://chat.example/reset-password?token=SUPERSECRETTOKENVALUE">Choose</a>',
  });
  const logged = lines.join('\n');
  expect(logged).toMatch(/MAIL NOT CONFIGURED/);
  expect(logged).toContain('person@example.com');
  expect(logged).not.toMatch(/reset-password\?token=/);
  expect(logged).not.toContain('SUPERSECRETTOKENVALUE');
});
