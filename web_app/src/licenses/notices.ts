import noticeManifest from '../../../third-party-notices.json'

export interface SoftwareNotice {
  name: string
  packageName: string
  version: string
  license: string
  copyright: string[]
  licenseText: string
  repository?: string
}

/** Offline notice payload generated from Create Studio and shipped app dependencies. */
export const SOFTWARE_NOTICES: readonly SoftwareNotice[] = noticeManifest.packages
