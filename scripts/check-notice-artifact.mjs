import { readdir, readFile } from 'node:fs/promises'

const assets = new URL('../web_app/dist/assets/', import.meta.url)
const files = (await readdir(assets)).filter((name) => name.endsWith('.js'))
const output = (await Promise.all(files.map((name) => readFile(new URL(name, assets), 'utf8')))).join('\n')
for (const required of ['Open Source Licences', 'Fabric.js', 'Permission is hereby granted']) {
  if (!output.includes(required)) throw new Error(`Production web artifact is missing bundled notice content: ${required}`)
}
