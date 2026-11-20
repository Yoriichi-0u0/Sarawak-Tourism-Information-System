# Sarawak Tourism Information System

SWE30003 Assignment 03 Option B. This package contains the React client, the local Node.js and SQLite assessment service, its tests and a prebuilt assessment client. The assessment build supports T1 Explore Destinations, T5 Find Events, T6 Plan Itinerary and T8 Maintain Tourism Information. Staff can maintain all six tourism record categories. The catalogue includes synthetic demonstration records.

The standard Vite build produces the browser-local prototype. The Option B assessment runs on your computer and stores its data in SQLite. Setup requires no hosted service or database account.

## Start the assessment build

Use **Node.js 25.8.1 and npm 11.11.0**, the versions used for the clean-extraction verification. Install the dependencies in the extracted folder. The install must include development dependencies because the AS03 runner uses Vite and tsx.

```sh
node --version
npm --version
npm ci
```

The submission archive includes `dist-as03/`. Run `npm run build:as03` when starting from a source checkout or to reproduce that build.

Use the following commands in Bash or Zsh to set up staff access for a fresh profile. Choose a new synthetic password of 12–200 characters and enter it at the silent prompt.

```sh
export AS03_DATA_PROFILE=assessment
printf 'Choose a temporary staff password: '
IFS= read -r -s AS03_STAFF_PASSWORD
printf '\n'
export AS03_STAFF_PASSWORD
npm run start:as03
```

Open **http://127.0.0.1:4183/**. The service accepts loopback requests. To demonstrate staff operations, open **Staff** and enter the password you chose. Tourists can browse and create a guest itinerary without staff access. Keep the generated guest link private because it grants access to that plan.

Stop the server with **Ctrl+C**, then run `unset AS03_STAFF_PASSWORD` to clear the shell setting. Restart with the same `AS03_DATA_PROFILE` to reopen that profile and its itineraries. The previously chosen password remains valid for that profile.

## Reproduce both builds and tests

Run these commands from the extracted directory after `npm ci`.

```sh
npm test
npm run build
npm run build:as03
npm exec -- tsc --noEmit --incremental false
```

| Command | Result |
|---|---|
| `npm test` | Runs the prototype and AS03 automated tests |
| `npm run build` | Builds the standard static prototype in `dist/` |
| `npm run build:as03` | Builds the assessment client in `dist-as03/` |
| `npm run start:as03` | Serves the assessment build and API at `127.0.0.1:4183` |
| `npm run dev:as03` | Starts the same local API with the development client on `127.0.0.1:5183` |

Use the package lockfile with `npm ci`. The package resolves dependencies from the npm registry. Playwright and Chromium are independent review tools and are unnecessary for installing or using the application.

## Try the four workflows

1. **T1 Explore Destinations.** Search for Bako by name, filter by interest, compare two destinations, and select one for an itinerary. A no-match search retains the initial interest suggestions.
2. **T5 Find Events.** Search for the synthetic Kuching cultural showcase by location and the sample date **27 November 2026**. Open the event details to review its venue, status and configured external referral. The sample referral goes to `https://example.org/`.
3. **T6 Plan Itinerary.** Save the destination and event to a plan. Use overlapping timed entries to see a conflict, then revise the times to make them adjacent. Copy the guest link, reopen it in a fresh browser context, and remove an entry or delete the plan.
4. **T8 Maintain Tourism Information.** Sign in through Staff. Save an incomplete event draft and attempt publication to see field validation. Correct the draft, publish it and then withdraw the record. A saved guest plan continues to show its own planned interval after a publication update or withdrawal.

## Database and troubleshooting

| Symptom or setting | Action |
|---|---|
| Node cannot load `node:sqlite`, or Vite dependencies fail to load | Check `node --version` and `npm --version`. Use the verified versions and reinstall with `npm ci`. If `NODE_ENV=production` omits development dependencies, run `npm ci --include=dev`. |
| Port 4183 is already in use | Stop the other local process or use `npm run start:as03 -- --port 4184` and open `http://127.0.0.1:4184/`. |
| The assessment page is missing after startup | Run `npm run build:as03` from the extracted directory. Confirm that `dist-as03/index.html` exists. The standard `dist/` output is the prototype. |
| Staff sign-in is unavailable | Stop the server, set `AS03_STAFF_PASSWORD` and restart the same profile. If the staff account already exists, use its original password or choose a fresh synthetic profile. Restarting with a different password does not overwrite an existing account. |
| A fresh catalogue is needed | Choose a new `AS03_DATA_PROFILE` name with 1–40 ASCII letters, digits, underscores or hyphens. Startup creates `.as03-data/<profile>.sqlite`, initializes the schema, and seeds an empty catalogue. The default profile is `local`. Existing profiles are preserved. |
| Cannot create or write the database | Extract to a writable directory and stop any other instance using the same profile. Keep each test profile separate from any real data. |
| Guest link cannot reopen a plan | Check that the server is running on the link's origin and is using the profile that created the plan. The link stops working after the itinerary is deleted. |

Database setup is implemented in `server/as03/storage.ts` and `server/as03/seed.ts`. No database file is needed in the archive. Keep generated `.as03-data/` files on your computer because they can contain saved plans and credential digests.

## Scope

The assessment release is intended for a locally run demonstration. It uses a single staff account per SQLite profile and capability links for guest itineraries. External bookings, event registration and payments are handled by third-party providers. The package demonstrates local behavior with seeded data. The hosted prototype and any hosted database are separate from this assessment runtime.
