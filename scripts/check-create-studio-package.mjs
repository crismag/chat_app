import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

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
