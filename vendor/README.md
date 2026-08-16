# Create Studio package artifact

Phase 3 consumes Create Studio through its public npm package boundary. The
package is private and has not been published, so this directory carries the
exact `npm pack` output from the merged Phase 2 commit recorded in
`create-studio-package.json`.

This is an interim release transport, not a fork or a source copy. It contains
Create Studio's compiled package, types, README, dependency inventory, adapted
source register, and required notices. Replace the file dependency with an
owner-approved private registry release when repository/package access is
configured; do not replace it with imports from a sibling checkout.
