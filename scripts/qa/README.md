# Browser QA suites

End-to-end checks run against a local server with isolated synthetic data. They need `playwright-core` and a browser, which are not project dependencies; install them outside the repository.

```sh
# 1. Start an isolated server (fresh PGlite profile, synthetic admin; never set DATABASE_URL here)
STIS_DATA_PROFILE=qa-$(date +%s) STIS_ADMIN_EMAIL=qa-admin@example.test STIS_ADMIN_PASSWORD=<synthetic> npm run build && npm start

# 2. In another shell, from a folder where playwright-core is installed
QA_ADMIN_EMAIL=qa-admin@example.test QA_ADMIN_PASSWORD=<synthetic> node journey.mjs <screenshot-dir> 1366   # desktop
QA_ADMIN_EMAIL=qa-admin@example.test QA_ADMIN_PASSWORD=<synthetic> node journey.mjs <screenshot-dir> 390    # mobile
node filters.mjs
node keyboard.mjs
```

- `journey.mjs`: 27 steps across T1, T3, T5–T8, accounts, guest claim, view-only sharing, staff publication and withdrawal, permissions. Mutates data, so use a fresh profile per run.
- `filters.mjs`: per-category filters, no-match and unavailable states (T1, T2, T4, T5, T7).
- `keyboard.mjs`: skip link, theme radio group, dialog focus and Escape, mobile menu.

Optional: `STIS_QA_BROWSER` (browser executable path) and `STIS_QA_BASE` (default `http://127.0.0.1:4173`).
