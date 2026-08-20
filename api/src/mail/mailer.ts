/*
 * Sending an email, and what happens when nothing is configured to.
 *
 * One interface, two implementations, and the second one matters more than it
 * looks. A password-reset route that throws because SMTP is unset would tell
 * the person "something went wrong" for a reason that is nothing to do with
 * them and nothing they can fix — and, worse, would make the reply depend on
 * whether the address had an account, since only an existing account reaches
 * the send. So an unconfigured deployment writes the link to the log and the
 * route answers exactly as it always does.
 *
 * That is a real fallback, not a pretend one: an operator can read the log and
 * hand somebody their link. It is not a substitute for configuring mail, and
 * it says so where it appears.
 *
 * Credentials come from the environment. Nothing here has a default password,
 * a default host, or a hard-coded address.
 */

import nodemailer from 'nodemailer';

export type Message = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface Mailer {
  /** True when a message can actually leave the building. */
  readonly configured: boolean;
  send(message: Message): Promise<void>;
}

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  /** Implicit TLS on 465; STARTTLS otherwise. */
  secure: boolean;
};

/**
 * Read the mail settings, or say there are none.
 *
 * All or nothing: a half-configured mailer that fails at send time is worse
 * than one that admits at start-up that it cannot send.
 */
export function readMailConfig(env: NodeJS.Dict<string> = process.env): MailConfig | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  if (!host || !user || !password) return null;

  const port = Number(env.SMTP_PORT ?? 465);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 465,
    user,
    password,
    /* The address people see. Defaults to the account doing the sending. */
    from: env.SMTP_FROM?.trim() || user,
    secure: (env.SMTP_SECURE?.trim().toLowerCase() ?? '') === 'false' ? false : port === 465,
  };
}

class SmtpMailer implements Mailer {
  readonly configured = true;
  private readonly config: MailConfig;
  private transport: nodemailer.Transporter | null = null;

  constructor(config: MailConfig) {
    this.config = config;
  }

  /* Made on first use, so a deployment that never sends never connects. */
  private get sender(): nodemailer.Transporter {
    this.transport ??= nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.user, pass: this.config.password },
    });
    return this.transport;
  }

  async send(message: Message): Promise<void> {
    await this.sender.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

/**
 * No mail configured: the message goes to the log.
 *
 * Deliberately loud about being a fallback, and deliberately still successful
 * — the caller's behaviour must not change according to whether mail works,
 * or the reply to "I forgot my password" starts leaking who has an account.
 */
class LoggingMailer implements Mailer {
  readonly configured = false;
  private readonly log: (line: string) => void;

  constructor(log: (line: string) => void = console.warn) {
    this.log = log;
  }

  send(message: Message): Promise<void> {
    this.log(
      [
        'MAIL NOT CONFIGURED — this message was not sent.',
        `  to:      ${message.to}`,
        `  subject: ${message.subject}`,
        message.text
          .split('\n')
          .map((line) => `  | ${line}`)
          .join('\n'),
        '  Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to send this properly.',
      ].join('\n'),
    );
    return Promise.resolve();
  }
}

export function createMailer(env: NodeJS.Dict<string> = process.env): Mailer {
  const config = readMailConfig(env);
  return config ? new SmtpMailer(config) : new LoggingMailer();
}
