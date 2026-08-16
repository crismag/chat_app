import { readFile, writeFile } from 'node:fs/promises'

const checking = process.argv.includes('--check')
const root = new URL('../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))
const studio = await readJson('node_modules/@crismag/create-studio/third-party-notices.json')

const appPackages = [
  { packageName: 'react', name: 'React', repository: 'https://github.com/facebook/react' },
  { packageName: 'react-dom', name: 'React DOM', repository: 'https://github.com/facebook/react' },
  { packageName: 'react-router', name: 'React Router', repository: 'https://github.com/remix-run/react-router' },
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
