import { readFile, writeFile } from 'node:fs/promises'

const checking = process.argv.includes('--check')
const root = new URL('../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))
const studio = await readJson('node_modules/@crismag/create-studio/third-party-notices.json')

const appPackages = [
  { packageName: 'react', name: 'React', repository: 'https://github.com/facebook/react' },
  { packageName: 'react-dom', name: 'React DOM', repository: 'https://github.com/facebook/react' },
  { packageName: 'react-router', name: 'React Router', repository: 'https://github.com/remix-run/react-router' },
  { packageName: '@capacitor/core', name: 'Capacitor', repository: 'https://github.com/ionic-team/capacitor' },
  { packageName: '@capacitor/app', name: 'Capacitor App', repository: 'https://github.com/ionic-team/capacitor-plugins' },
  { packageName: '@capacitor/keyboard', name: 'Capacitor Keyboard', repository: 'https://github.com/ionic-team/capacitor-plugins' },
  { packageName: '@capacitor/status-bar', name: 'Capacitor Status Bar', repository: 'https://github.com/ionic-team/capacitor-plugins' },
  { packageName: '@capacitor/share', name: 'Capacitor Share', repository: 'https://github.com/ionic-team/capacitor-plugins' },
  { packageName: '@capacitor/filesystem', name: 'Capacitor Filesystem', repository: 'https://github.com/ionic-team/capacitor-plugins' },
]

const packages = [...studio.packages]
for (const item of appPackages) {
  const directory = `node_modules/${item.packageName}/`
  const manifest = await readJson(`${directory}package.json`)
  const licenseText = (await readFile(new URL(`${directory}LICENSE`, root), 'utf8')
    .catch(() => readFile(new URL(`${directory}LICENSE.md`, root), 'utf8'))).trim()
  const copyright = licenseText.split('\n').filter((line) => line.startsWith('Copyright'))
  packages.push({
    ...item,
    version: manifest.version,
    license: manifest.license,
    copyright,
    licenseText,
    status: 'production-dependency',
  })
}

/*
 * Data, not software, and the one entry here that is not an npm package.
 *
 * The banned-word list in api/moderation-lists/ is CC-BY-4.0, and attribution
 * is a condition of that licence rather than a courtesy. It ships inside the
 * application, so it is named where the other notices are named. Its details
 * live in api/moderation-lists/sources.json; this is the same facts, in the
 * shape the licences page reads.
 */
packages.push({
  packageName: 'LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words',
  name: 'List of Dirty, Naughty, Obscene and Otherwise Bad Words',
  repository: 'https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words',
  version: '4638b970cb8d9d82789564fcba1f4a1eb508ff1a',
  license: 'CC-BY-4.0',
  copyright: ['Copyright Shutterstock, Inc.'],
  licenseText: [
    'Licensed under the Creative Commons Attribution 4.0 International License',
    '(CC BY 4.0): https://creativecommons.org/licenses/by/4.0/',
    '',
    'Used as word data for tag moderation. The file is included unmodified.',
  ].join('\n'),
  status: 'bundled-data',
})

const structured = `${JSON.stringify({ schemaVersion: 1, packages }, null, 2)}\n`
const markdown = `# Third-party notices

C.H.A.T. includes third-party software. These notices are bundled into the
production application and its offline Open Source Licences page.

${packages.map((item) => `## ${item.name}

Package: \`${item.packageName}\`

Version: ${item.version}

Licence: ${item.license}

${item.copyright.join('\n\n')}

${item.licenseText}`).join('\n\n')}
`

async function output(path, content) {
  const url = new URL(path, root)
  if (checking) {
    const current = await readFile(url, 'utf8').catch(() => '')
    if (current !== content) throw new Error(`${path} is stale. Run npm run notices:generate.`)
    return
  }
  await writeFile(url, content)
}

await output('third-party-notices.json', structured)
await output('THIRD_PARTY_NOTICES.md', markdown)
