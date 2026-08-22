/*
 * Refresh the cached disposable-domain registry.
 *
 *   npm run email:update-registry --workspace api
 *
 * Run from a deployment step or a cron job. Never from a request: sign-in has
 * to keep working when GitHub does not.
 */
import { fetchUpstreamList, updateDisposableRegistry } from './registry-update.ts';

const directory = process.env['EMAIL_DOMAIN_LIST_DIR']?.trim();
if (!directory) {
  console.error('EMAIL_DOMAIN_LIST_DIR is not set; nothing to update.');
  process.exit(2);
}

const result = await updateDisposableRegistry({ directory, fetchList: () => fetchUpstreamList() });

if (result.ok) {
  /* Time and outcome, and nothing that could be a credential. */
  console.log(`registry_update_success domains=${String(result.domains)} path=${result.path}`);
  process.exit(0);
}

console.error(`registry_update_failure reason="${result.reason}" (the previous registry is untouched)`);
process.exit(1);
