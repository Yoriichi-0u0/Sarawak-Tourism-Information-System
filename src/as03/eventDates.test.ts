import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDate, formatStart } from "./eventDates.ts";

test("calendar dates are written out without timezone conversion", () => {
  assert.equal(formatDate("2026-12-05"), "5 December 2026");
  assert.equal(formatDate("2026-01-01"), "1 January 2026");
  assert.equal(formatDate("2026-12-31"), "31 December 2026");
  for (const invalid of ["", "2026-13-01", "2026-00-10", "05-12-2026", "2026-12-05T10:00"])
    assert.equal(formatDate(invalid), undefined, invalid);
});

test("published local start times keep their Kuching wall-clock time", () => {
  assert.equal(formatStart("2026-12-05T10:00"), "5 December 2026, 10:00 MYT");
  assert.equal(formatStart("2026-11-27T00:15"), "27 November 2026, 00:15 MYT");
  assert.equal(formatStart("2026-11-27T23:45"), "27 November 2026, 23:45 MYT");
  for (const invalid of ["", "2026-12-05", "2026-12-05T10:00Z", "2026-12-05 10:00"])
    assert.equal(formatStart(invalid), undefined, invalid);
});

test("formatting does not depend on the process timezone", () => {
  const saved = process.env.TZ;
  try {
    for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(formatStart("2026-11-27T23:45"), "27 November 2026, 23:45 MYT", zone);
      assert.equal(formatDate("2026-11-27"), "27 November 2026", zone);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
