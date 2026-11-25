# Database documentation (full-system release)

Documentation of the STIS PostgreSQL database (Supabase, schema `stis`), verified against production on 25 November 2026.
It does not describe the SQLite database of the AS03 assessment build.

| File | Contents |
|---|---|
| `DATABASE_AUDIT.md` | Schema inventory, live-data invariants, T1–T8 and extension traceability, security review, findings DB-01 to DB-08 |
| `DATABASE_DESIGN.md` | Table purposes, relationships and cardinalities, normalisation, constraints, indexes, concurrency, security model |
| `MIGRATION_REPORT.md` | Migration history, drift check, rollback approach, the proposed (unapplied) hardening migration |
| `FINAL_VERIFICATION.md` | Commands, exit codes, test counts, hosted checks, limitations, release recommendation |
| `DATABASE_ERD.drawio` | Editable diagrams in four pages: conceptual model, two physical pages, access and security |
| `DATABASE_ERD-*.svg`, `DATABASE_ERD-*.png` | Exports of each page (PNG at 2×) |
| `schema-snapshot.json` | Catalog export of a clean build of the migrations, identical to production |

Regenerate the diagrams after a schema change:

```sh
python3 -I scripts/database/erd.py
STIS_QA_BROWSER=<path to Chrome or Chromium> node scripts/database/render-erd.mjs .
```

`render-erd.mjs` needs `playwright-core`, which is not a project dependency. Run it from a directory where that package is
installed, passing the repository path as the argument.
