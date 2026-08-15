# TDD behavior mapping

Targeted verification is mapped to the product behaviors that changed in this run. Generic suite success is not used as the only proof.

| Changed behavior | Targeted test | Evidence |
| --- | --- | --- |
| Unauthenticated visitors cannot enter the private workspace | `web_app/src/app/App.test.tsx` — unauthenticated visitors are asked to sign in | `tdd/red.txt`, `tdd/green.txt` |
| Signed-in users see Conversation plus Context / Heart / Application / Testimony | `web_app/src/app/App.test.tsx` — signed-in users land on a private conversation workspace | `tdd/green.txt` |
| Library search is owner-only | `api/src/app.test.ts` — finds the owner conversation by scripture reference and hides others; `web_app` library copy | `tdd/red.txt`, `tdd/green.txt` |
| Community shows only explicitly published C.H.A.T.s | `api/src/app.test.ts` — only an explicit publish makes an entry community-visible | `tdd/red.txt`, `tdd/green.txt` |
| Unpublish returns an entry to private | `api/src/app.test.ts` — unpublish removes a conversation from the community feed | `tdd/green.txt` |
| Private conversation can be left and continued | `api/src/app.test.ts` — a user can create a conversation, leave, and continue it | `tdd/red.txt`, `tdd/green.txt` |
| Strangers cannot open private conversations | `api/src/app.test.ts` — another user cannot retrieve a private conversation | `tdd/red.txt`, `tdd/green.txt` |
| Extract C.H.A.T. does not invent Heart or Testimony | `api/src/app.test.ts` — extract leaves Heart and Testimony empty when the user did not express them | `tdd/red.txt`, `tdd/green.txt` |
| Grammar assistance preserves the original message | `api/src/app.test.ts` — grammar assistance preserves the original message | `tdd/red.txt`, `tdd/green.txt` |
| Create renders text in-app | `web_app/src/app/App.test.tsx` — create engine keeps text in the app | `tdd/green.txt` |

No code-task TDD exception was used. Failing-first evidence was recorded in `tdd/red.txt` before the API routes existed; the green rerun is `tdd/green.txt`.
