/*
 * Process entry point.
 *
 * A plain .mjs so a process manager that expects JavaScript — Passenger, pm2,
 * a systemd unit — has something to point at. It does nothing but start the
 * API, which is TypeScript that Node runs directly.
 *
 * Node's type stripping is enough for this codebase because `tsconfig` sets
 * `erasableSyntaxOnly`: there are no enums, namespaces or parameter properties
 * for it to trip over. That is why the remote needs no build step and no tsx.
 */
process.env.NODE_ENV ??= 'production';
await import('./api/src/index.ts');
