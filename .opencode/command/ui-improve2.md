---
description: Autonomously audit, improve and browser-verify the frontend
agent: orchestrator
---

Autonomously audit and improve the frontend of this project.

Additional user focus:
$ARGUMENTS

Do not redesign blindly and do not stop after the first successful change.

1. Inspect the existing architecture, UI and design language.
2. Create a prioritized todo list.
3. Start/reuse the frontend dev server yourself.
4. Open the real application through Playwright MCP.
5. Exercise the important user flows.
6. Check desktop (~1440x900) and mobile (~390x844).
7. Capture screenshots, inspect accessibility snapshots, console messages and network requests.
8. Prioritize gameplay/UX blockers before cosmetic polish.
9. Delegate substantial implementation to `coder`.
10. Re-run the affected browser flow after each meaningful group of changes.
11. Delegate independent code + visual verification to `reviewer`.
12. Send BLOCKER/HIGH findings back to `coder` and repeat verification.
13. Run the project's relevant typecheck/tests/build/verify commands.

Continue:

inspect -> prioritize -> implement -> run -> browser verify -> review -> fix

Stop when no BLOCKER/HIGH frontend findings remain, required flows work, relevant console/network failures are gone,
desktop/mobile have no major overflow/clipping, verification commands pass, and two consecutive reviews produce no
important actionable frontend findings.

Do not ask for approval for routine engineering decisions. Do not push/deploy. Do not use destructive git operations.
Do not modify unrelated backend behavior.
