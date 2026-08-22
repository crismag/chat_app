# Paste this to start an implementation session

Copy everything below the line into a new Claude (or Cursor) conversation after it can see this repository.

---

You are implementing the 2026-08-22 C.H.A.T. audit. Do not re-audit. Do not implement product features that are not findings.

Read, in order:

1. `docs/audit-remediation/README.md`
2. `docs/audit-remediation/INSTRUCTIONS.md`
3. `docs/audit-remediation/DO-NOT.md`
4. `docs/audit-remediation/APPROVALS.md`
5. `docs/audit-remediation/CONTEXT.md`
6. `docs/audit-remediation/FINDINGS.md`
7. `docs/audit-remediation/CODEREVIEWERASSIST.md`
8. `docs/audit-remediation/ROADMAP.md`
9. `docs/audit-remediation/STATUS.md`
10. Only the phase file for the work you are allowed to do, under `docs/audit-remediation/phases/`

Then read `docs/development/DEVELOPMENT_INSTRUCTIONS.md` and inspect the current code. Line numbers in the pack may have drifted. `CODEREVIEWERASSIST.md` records what was already in the working tree on 2026-08-22 — grep before re-implementing P0.

Default work: **P0**, one finding per commit, skip anything in APPROVALS.md until I name it. If P0 is already in the tree with tests, tick STATUS.md and continue with unfinished P1 items. Do not restore deleted `/api/library` or `/api/community` handlers.

Constraints:

- Dedicated branch. Do not commit to main unless I ask.
- Preserve externally observable behavior unless the finding and APPROVALS say otherwise.
- Deletion > consolidation > new abstraction.
- Do not start P5 (one database) or rewrite ChatPage until that phase is requested.
- Do not migrate onto unused MariaDB `reflection_revisions` / `chat_content` JSON.
- Do not add Redis, queues, workers, or a client state library.
- New authz tests use SqliteStore (and MysqlAuthStore when the finding is MariaDB), not MemoryStore.
- Run the relevant tests before and after. Do not weaken tests to match a behavior change.
- Update `docs/audit-remediation/STATUS.md` for findings you close.
- When you finish a finding, stop and report: IDs closed, files, tests, behavior change, what remains gated.

If I have not named a finding, grep the P0 table in `CODEREVIEWERASSIST.md` first. Re-implement nothing that is already in the tree. Ask before gated items (B1, S1, S4, S7, S2 fail-closed).

Owner: Cris.
