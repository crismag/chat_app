import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const metadata = JSON.parse(await readFile(new URL('vendor/create-studio-package.json', root), 'utf8'))
const artifact = new URL(`vendor/${metadata.artifact}`, root)
const bytes = await readFile(artifact)
const digest = createHash('sha256').update(bytes).digest('hex')
if (digest !== metadata.sha256) throw new Error('The pinned Create Studio package checksum changed.')

const entries = execFileSync('tar', ['-tzf', artifact.pathname], { encoding: 'utf8' })
for (const required of [
  'package/package.json',
  'package/README.md',
  'package/THIRD_PARTY_NOTICES.md',
  'package/third-party-notices.json',
  'package/docs/development/dependencies.md',
  'package/docs/development/adapted-sources.md',
]) {
  if (!entries.split('\n').includes(required)) throw new Error(`Create Studio package is missing ${required}.`)
}

const manifest = JSON.parse(execFileSync('tar', ['-xOzf', artifact.pathname, 'package/package.json'], { encoding: 'utf8' }))
if (manifest.name !== metadata.package || manifest.version !== metadata.version) {
  throw new Error('Create Studio artifact identity does not match its provenance record.')
}
if (manifest.license !== 'UNLICENSED' || manifest.private !== true) {
  throw new Error('Create Studio publishing restriction changed and requires owner review.')
}

if (!/^[0-9a-f]{40}$/.test(metadata.sourceCommit ?? '')) {
  throw new Error('The Create Studio provenance record needs a full 40-character source commit.')
}

/*
 * The checksum proves the artifact has not changed; it says nothing about
 * whether the commit it claims to come from still exists. A squashed or
 * rebased merge upstream rewrites the SHA, and the record then points at
 * history no one can reach — which is how this record went stale once already.
 * Verified against a sibling checkout when one is available, because that is
 * where the person changing the pin is working.
 */
const checkout = process.env.CREATE_STUDIO_REPO ?? fileURLToPath(new URL('../create_studio/', root))
const branch = metadata.sourceBranch ?? 'main'
if (existsSync(`${checkout.replace(/\/$/, '')}/.git`)) {
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('cat-file', '-e', `${metadata.sourceCommit}^{commit}`)
  } catch {
    throw new Error(`Create Studio commit ${metadata.sourceCommit} does not exist in ${checkout}. Re-pin the vendored artifact.`)
  }
  const reachable = [`origin/${branch}`, branch].some((ref) => {
    try {
      git('merge-base', '--is-ancestor', metadata.sourceCommit, ref)
      return true
    } catch {
      return false
    }
  })
  if (!reachable) {
    throw new Error(`Create Studio commit ${metadata.sourceCommit} is not reachable from ${branch}. Re-pin the vendored artifact to merged history.`)
  }
  console.log(`Create Studio provenance verified against ${branch} in ${checkout}.`)
} else {
  console.log(`Create Studio commit ancestry not verified: no checkout at ${checkout}. Set CREATE_STUDIO_REPO to check it.`)
}
