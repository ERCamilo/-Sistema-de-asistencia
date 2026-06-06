/**
 * 🧪 ResumeFromBadgeTests
 *
 * Bug reported (2026-05-28): users were stuck in cloudUploadPaused = true
 * because (a) earlier versions silently set it via Escape, and (b) the flag
 * persists across sessions in IndexedDB, and (c) there was NO UI to resume.
 *
 * Fix: clicking the orange "paused" badge prompts the user to resume.
 *
 * Contracts:
 *
 *   SyncStatusBadge (renderSyncStatusBadge):
 *     - The paused-state HTML must include cursor:pointer so it visually
 *       signals it's clickable.
 *
 *   SyncStatusBadge (attachLiveBadge):
 *     - Must accept an onPausedClick callback and wire a click-delegation
 *       handler that fires it when a paused badge is clicked.
 *     - detachLiveBadge must remove that handler.
 *
 *   app.js:
 *     - Must pass an onPausedClick option to attachLiveBadge.
 *     - That handler must call Modal.confirm and, on yes, resumeCloudUpload().
 *
 *   app.js (boot-time notification):
 *     - If the app loads with isSyncPaused() === true, show a notification
 *       so the user knows why nothing is syncing.
 */

import fs from 'fs';
import path from 'path';

import { renderSyncStatusBadge, attachLiveBadge, detachLiveBadge } from '../modules/ui/SyncStatusBadge.js';

const BADGE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/SyncStatusBadge.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// Visual cue: paused badge looks clickable
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("ResumeFromBadge — paused badge looks clickable", {

    "paused badge HTML contains cursor:pointer (visual cue)"() {
        const html = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true,
            lastSyncedAt: Date.now(),
            isUploadPaused: true
        });
        testRunner.assert(
            /cursor:\s*pointer/i.test(html),
            `Paused badge must signal it's clickable via cursor:pointer. HTML: ${html.slice(0, 400)}`
        );
    },

    "paused badge in compact mode also has cursor:pointer"() {
        const html = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true,
            lastSyncedAt: Date.now(),
            isUploadPaused: true,
            compact: true
        });
        testRunner.assert(
            /cursor:\s*pointer/i.test(html),
            `Compact paused badge must also signal clickability. HTML: ${html.slice(0, 400)}`
        );
    },

    "non-paused badges do NOT have cursor:pointer (cosmetic, no click handler)"() {
        const html = renderSyncStatusBadge({
            isAuthenticated: true, isOnline: true,
            lastSyncedAt: Date.now()
            // not paused
        });
        // synced badge uses cursor:default (or unset); never pointer.
        testRunner.assert(
            !/cursor:\s*pointer/i.test(html),
            'Non-paused badges must not have cursor:pointer (no click action available)'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// Click delegation: onPausedClick fires when paused badge clicked
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("ResumeFromBadge — attachLiveBadge onPausedClick wiring", {

    "attachLiveBadge accepts onPausedClick and fires on click"() {
        // Note: attachLiveBadge calls _refreshAllBadges which replaces existing
        // badge elements via outerHTML — so we must re-query after attach.
        document.body.innerHTML = '';
        const seed = document.createElement('div');
        seed.setAttribute('data-role', 'sync-badge');
        seed.setAttribute('data-state', 'paused');
        document.body.appendChild(seed);

        let calls = 0;
        attachLiveBadge({
            getAuth: () => true,
            getOnline: () => true,
            getUploadPaused: () => true,
            onPausedClick: () => calls++
        });

        // Re-query: original `seed` is detached after _refreshAllBadges.
        const live = document.querySelector('[data-role="sync-badge"][data-state="paused"]');
        testRunner.assert(!!live, 'A paused badge must be present after attachLiveBadge');
        live.click();
        testRunner.assertEquals(calls, 1, 'onPausedClick must fire when a paused badge is clicked');

        detachLiveBadge();
        document.body.innerHTML = '';
    },

    "onPausedClick does NOT fire when a non-paused badge is clicked"() {
        document.body.innerHTML = '';
        const seed = document.createElement('div');
        seed.setAttribute('data-role', 'sync-badge');
        seed.setAttribute('data-state', 'synced');
        document.body.appendChild(seed);

        let calls = 0;
        attachLiveBadge({
            getAuth: () => true,
            getOnline: () => true,
            getUploadPaused: () => false,
            onPausedClick: () => calls++
        });

        const live = document.querySelector('[data-role="sync-badge"]');
        testRunner.assert(!!live, 'A badge must be present after attachLiveBadge');
        live.click();
        testRunner.assertEquals(calls, 0, 'onPausedClick must only fire for data-state="paused" badges');

        detachLiveBadge();
        document.body.innerHTML = '';
    },

    "detachLiveBadge removes the click handler"() {
        document.body.innerHTML = '';
        const seed = document.createElement('div');
        seed.setAttribute('data-role', 'sync-badge');
        seed.setAttribute('data-state', 'paused');
        document.body.appendChild(seed);

        let calls = 0;
        attachLiveBadge({
            getAuth: () => true, getOnline: () => true, getUploadPaused: () => true,
            onPausedClick: () => calls++
        });
        // Verify the handler IS attached first (sanity check).
        let live = document.querySelector('[data-role="sync-badge"][data-state="paused"]');
        live.click();
        testRunner.assertEquals(calls, 1, 'Sanity: handler fires before detach');

        detachLiveBadge();
        // After detach, clicks on the still-present badge must NOT fire.
        live = document.querySelector('[data-role="sync-badge"][data-state="paused"]');
        if (live) live.click();
        testRunner.assertEquals(calls, 1, 'After detach, click count must remain 1 (handler removed)');

        document.body.innerHTML = '';
    }

});

// ─────────────────────────────────────────────────────────────
// app.js wiring — onPausedClick + resume
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("ResumeFromBadge — app.js wiring", {

    "app.js passes onPausedClick to attachLiveBadge"() {
        const block = APP_SRC.match(/attachLiveBadge\s*\(\s*\{[\s\S]{0,1500}\}\s*\)/);
        testRunner.assert(
            !!block && /onPausedClick\s*:/.test(block[0]),
            'app.js must pass an onPausedClick callback to attachLiveBadge'
        );
    },

    "onPausedClick handler in app.js shows Modal.confirm"() {
        const block = APP_SRC.match(/onPausedClick\s*:[\s\S]{0,800}/);
        testRunner.assert(
            !!block && /Modal\.confirm/.test(block[0]),
            'onPausedClick must use Modal.confirm to ask the user before resuming'
        );
    },

    "on confirm, calls resumeCloudUpload"() {
        const block = APP_SRC.match(/onPausedClick\s*:[\s\S]{0,1500}/);
        testRunner.assert(
            !!block && /resumeCloudUpload\s*\(/.test(block[0]),
            'onPausedClick handler must call resumeCloudUpload() when user confirms'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js boot-time notification: tell user if they're paused
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("ResumeFromBadge — boot-time paused-state notice", {

    "app.js calls isSyncPaused at startup and shows a notification if true"() {
        // Look for a startup-time check that conditionally shows a notification.
        // Pattern: somewhere in initializeApp (after loadApplicationData), there
        // must be an `if (isSyncPaused())` followed by `showNotification`.
        testRunner.assert(
            /isSyncPaused\s*\(\s*\)[\s\S]{0,400}showNotification/.test(APP_SRC),
            'app.js must check isSyncPaused() at boot and notify the user if paused'
        );
    }

});

console.log('🧪 ResumeFromBadge tests cargados.');
