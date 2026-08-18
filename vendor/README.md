# Create Studio package artifact

C.H.A.T. consumes Create Studio through its public npm package boundary. The
package is private and has not been published, so this directory carries the
exact `npm pack` output from the merged upstream commit recorded in
`create-studio-package.json`.

This is an interim release transport, not a fork or a source copy. It contains
Create Studio's compiled package, types, README, dependency inventory, adapted
source register, and required notices. Replace the file dependency with an
owner-approved private registry release when repository/package access is
configured; do not replace it with imports from a sibling checkout.

## Pin only merged commits

`sourceCommit` must name a commit reachable from Create Studio's `main`. Pack
from a branch tip and a squashed or rebased merge upstream will rewrite that
SHA, leaving the record pointing at history no one can reach — the checksum
still matches, so nothing else notices. That happened once already, to the
Phase 5 pin.

`npm run lint` checks this whenever a Create Studio checkout is next to this
repository, or wherever `CREATE_STUDIO_REPO` points. Re-pinning means: build
and `npm pack` the upstream merge commit, replace the artifact, and update
`sourceCommit` and `sha256` together.
