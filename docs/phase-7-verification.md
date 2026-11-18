# Phase 7 verification — 2026-11-18

- All 56 backend/domain tests passed, including timezone/daylight-saving boundaries, invalid dates, completed-order gross and charge totals, permissions, settings version conflicts, staff creation/deactivation, session revocation and stale staff edits.
- Ten existing browser journeys passed in the broad run. The new reporting journey hit the unchanged ten-login rate limit; its fresh-server focused rerun passed. The complete browser suite has not passed in a single uninterrupted run.
- The new journey verifies staff creation, restaurant settings persistence after reload, order creation, report loading and CSV download. The report screenshot was visually reviewed; the subsequent layout update corrects its page title.
- TypeScript checks passed. Tests use temporary replica sets and do not seed or clear the restaurant database.

To avoid exhausting the production sign-in throttle in the test environment, run the existing journeys and the new journey in separate fresh-server invocations:

```powershell
npx playwright test --grep-invert "owner manages staff"
npx playwright test tests/e2e/reporting.spec.ts
```

See phase-7.md for report definitions and remaining product limitations.

Production build passed. Vite reports a non-blocking bundle-size warning and dependency annotation warnings.
