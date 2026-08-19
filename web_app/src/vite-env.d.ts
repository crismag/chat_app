/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/*
 * The legal documents are markdown, imported as text and rendered at runtime.
 * `vite/client` types `*?raw` already, but the .md extension needs saying so
 * TypeScript does not treat the import as an unknown asset.
 */
declare module '*.md?raw' {
  const content: string
  export default content
}
