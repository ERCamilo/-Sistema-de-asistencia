# Isolated two-client synchronization laboratory

This runs real Firebase SDK 10.8.0 and application repositories against local
Auth/Firestore emulators. It does not open the application's startup flow,
use a real account, import a backup, or validate production's deployed rules.
Two fresh Chromium contexts authenticate as one synthetic account. A third
synthetic account tests denial of cross-account reads and writes.

## Run

Requires Java 21+, Firebase CLI, Chromium and `npm ci` for the repository.
From the repository root, in a separate terminal:

```sh
firebase emulators:start --only auth,firestore --project demo-sa-sync-lab --config firebase.sync-lab.json
```

Then:

```sh
CHROMIUM_PATH=/snap/bin/chromium node scripts/sync-lab/two-clients.cjs
```

The emulators listen on loopback only (Firestore 9180, Auth 9199). The harness
serves code on loopback 9185. It replaces the Firebase bootstrap in memory with
an immutable `demo-sa-sync-lab` config. Browser requests are restricted to these
three local ports and GETs for the pinned gstatic SDK. No application file or
production Firebase configuration is rewritten. Account credentials are
synthetic and unique to each run. No emulator data export is performed.

## Results, 2026-09-25 UTC

Before the cash repository fix: old client wrote 200 over newer server amount
300. Reproduced with two independently authenticated browser contexts.

After the fix, all seven checks pass:

- Another account cannot read or write the test employee (2 checks).
- Reconnected old employee preserves both loan payments, totaling 200.
- An older cash save reports a conflict and preserves the server's 300 (2).
- The rejected local cash payload remains in the durable outbox for review.
- An older attendance save preserves the server's 10 hours instead of 8.

The cash write now reads and checks timestamps inside a Firestore transaction.
A failed read does not fall back to a blind write. Timestamp ordering is only
asserted for finite positive timestamps; legacy records with missing or invalid
metadata, equal timestamps and skewed device clocks need separate treatment.

## Coverage boundaries

This is repository/outbox integration, not full application UI validation.
Production rules, Google sign-in, real mobile devices, receipt Storage,
simultaneous conflicting employee edits and multi-device deletion recovery
are not certified by this test. No user production data was used.

Official emulator isolation reference:
https://firebase.google.com/docs/emulator-suite/connect_firestore
