# Phase 9 verification — 2026-11-19

- Full backend regression run: 63 tests passed across nine files. After strengthening the inventory/table fixture, all 24 configuration/integration tests passed again.
- Split/merge checks cover price/modifier conservation, manager permissions, stale versions, concurrent split exclusion, paid/adjusted/in-progress order rejection, unchanged consumed stock and release of the merged source's table.
- Printing checks cover immutable snapshots, idempotent queue creation, document permissions, competing claims, hidden claim tokens in listings, invalid/stale completion tokens, confirmation, retry and lease expiry.
- All 12 browser journeys passed through npm run test:e2e in two fresh-server batches. The billing journey was updated for Queue receipt. The new journey creates an order, splits and merges it, submits the kitchen ticket, queues a print, reloads, opens/retries the dialog and records staff confirmation.
- The initial browser run included the outdated print-button selector and a floor-test timeout; both journeys passed in the complete rerun. An incomplete inventory test fixture was corrected before the successful targeted backend rerun.
- TypeScript checks, production build and compiled-server smoke test passed. The print-queue screenshot was visually reviewed. Browser tests stub window.print; physical output and browser print-preview margins are not hardware-tested.
- Phase 8 commit dc82a65 passed its GitHub workflow, including Docker/Nginx/evaluation-stack checks. These Phase 9 changes are not yet pushed or CI-verified. Local Docker remains unavailable; no production hosting, printer or processor has been configured.

No restaurant data was reset, seeded or restored. Tests use disposable databases. Vite retains its existing bundle-size and dependency-annotation warnings. See phase-9.md for functional limits and phase-9-pilot.md for the pending real-restaurant acceptance checklist.
