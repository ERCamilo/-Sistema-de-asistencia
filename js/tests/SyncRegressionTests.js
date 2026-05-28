/**
 * 🧪 SyncRegressionTests
 *
 * Two regressions reported by the user (2026-05-28):
 *
 *   1. Changes made on one device weren't propagating to others. Root cause:
 *      the outgoing-conflict check fired during `_isApplyingRemoteData = true`
 *      (initial cloud sync), because localUpdatedAt is intentionally NOT
 *      refreshed during remote-apply, so the stale value tripped the check.
 *      The Firebase block wouldn't run anyway during remote-apply, so emitting
 *      the conflict event was a pure false positive.
 *
 *   2. The badge showed "paused" most of the time even though the user never
 *      explicitly clicked pause. Root cause: pressing Escape (or clicking the
 *      × close button) on the IncomingChangeModal silently triggered
 *      onRejectAndPause, setting cloudUploadPaused = true. Users dismissing
 *      the modal didn't realize they were pausing sync.
 *
 * Contracts:
 *
 *   PersistenceService._executeSave:
 *     - The outgoing-conflict check must be gated by the same conditions as
 *       the Firebase sync block (currentUser, !_isApplyingRemoteData,
 *       !cloudUploadPaused, !localOnly). If any of those fail, no conflict
 *       event should be emitted.
 *
 *   IncomingChangeModal:
 *     - Escape MUST NOT call onRejectAndPause (it must NOT silently pause).
 *     - Escape SHOULD call a new onDismiss callback (so the pending flag
 *       can be cleared and the modal can reappear on the next sync).
 *     - The × (close) button SHOULD also dismiss without action.
 */

import fs from 'fs';
import path from 'path';

const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);
const MODAL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/IncomingChangeModal.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// REGRESSION 1: outgoing conflict false positives
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SyncRegression — outgoing conflict gated by Firebase guard", {

    "conflict check is bypassed when _isApplyingRemoteData is true"() {
        // The block that sets _outgoingConflictReviewPending / emits the event
        // must check _isApplyingRemoteData so it doesn't fire during incoming sync.
        const conflictBlock = PERSISTENCE_SRC.match(
            /_hasOutgoingConflict[\s\S]{0,1000}sync:outgoing-conflict[\s\S]{0,500}/
        );
        // Either the check itself or the variable it's assigned from must reference _isApplyingRemoteData.
        const hasGuard = /_hasOutgoingConflict[\s\S]{0,400}_isApplyingRemoteData/.test(PERSISTENCE_SRC)
            || /_isApplyingRemoteData[\s\S]{0,400}_hasOutgoingConflict/.test(PERSISTENCE_SRC);
        testRunner.assert(
            hasGuard,
            'outgoing-conflict check must be gated by !_isApplyingRemoteData (prevents false positives on initial sync)'
        );
    },

    "conflict check is bypassed when there is no currentUser"() {
        const hasGuard = /_hasOutgoingConflict[\s\S]{0,400}currentUser/.test(PERSISTENCE_SRC)
            || /currentUser[\s\S]{0,400}_hasOutgoingConflict/.test(PERSISTENCE_SRC);
        testRunner.assert(
            hasGuard,
            'outgoing-conflict check must be gated by currentUser (no point if not authenticated)'
        );
    },

    "conflict check is bypassed when cloudUploadPaused is true"() {
        const hasGuard = /_hasOutgoingConflict[\s\S]{0,400}cloudUploadPaused/.test(PERSISTENCE_SRC)
            || /cloudUploadPaused[\s\S]{0,400}_hasOutgoingConflict/.test(PERSISTENCE_SRC);
        testRunner.assert(
            hasGuard,
            'outgoing-conflict check must be gated by !cloudUploadPaused (already not pushing anyway)'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// REGRESSION 2: Escape / × must NOT pause silently
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SyncRegression — IncomingChangeModal Escape/X must not auto-pause", {

    "Escape key handler does NOT call onRejectAndPause"() {
        // Match the actual handler (e.key === 'Escape'), not stray mentions in comments.
        const escBlock = MODAL_SRC.match(/e\.key\s*===\s*['"]Escape['"][\s\S]{0,400}/);
        testRunner.assert(!!escBlock, 'Modal must handle the Escape key via e.key === "Escape"');
        testRunner.assert(
            !/onRejectAndPause/.test(escBlock[0]),
            "Escape handler must NOT call onRejectAndPause — that silently pauses sync without user intent"
        );
    },

    "Escape key handler calls onDismiss (non-destructive)"() {
        const escBlock = MODAL_SRC.match(/e\.key\s*===\s*['"]Escape['"][\s\S]{0,400}/);
        testRunner.assert(
            !!escBlock && /onDismiss/.test(escBlock[0]),
            'Escape handler must call opts.onDismiss so the host can clear the pending-review flag'
        );
    },

    "× close button (data-action=reject) does NOT call onRejectAndReupload"() {
        // Match the querySelectorAll line that wires the × button click handler.
        const block = MODAL_SRC.match(
            /querySelectorAll\(['"]\[data-action="reject"\]['"]\)[\s\S]{0,500}\}\)/
        );
        testRunner.assert(!!block, 'Modal wires a click handler for data-action="reject" (the × button)');
        testRunner.assert(
            !/onRejectAndReupload\s*\(\)/.test(block[0]),
            "× close button must NOT auto-reupload — it must be a safe dismissal"
        );
    },

    "× close button calls onDismiss (non-destructive)"() {
        const block = MODAL_SRC.match(
            /querySelectorAll\(['"]\[data-action="reject"\]['"]\)[\s\S]{0,500}\}\)/
        );
        testRunner.assert(
            !!block && /onDismiss/.test(block[0]),
            '× close button handler must call opts.onDismiss'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js — wires onDismiss to clear _pendingIncomingReview
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SyncRegression — app.js wires onDismiss to clear _pendingIncomingReview", {

    "IncomingChangeModal.show in app.js passes onDismiss"() {
        const block = APP_SRC.match(/IncomingChangeModal\.show[\s\S]{0,2000}/);
        testRunner.assert(
            !!block && /onDismiss\s*:/.test(block[0]),
            'app.js must pass an onDismiss callback to IncomingChangeModal.show'
        );
    },

    "onDismiss in app.js clears _pendingIncomingReview"() {
        const block = APP_SRC.match(/onDismiss\s*:[\s\S]{0,300}/);
        testRunner.assert(
            !!block && /_pendingIncomingReview\s*=\s*false/.test(block[0]),
            'onDismiss must clear window._pendingIncomingReview so the modal can reappear on next sync'
        );
    },

    "onDismiss does NOT call pauseCloudUpload"() {
        const block = APP_SRC.match(/onDismiss\s*:[\s\S]{0,300}/);
        testRunner.assert(
            !!block && !/pauseCloudUpload/.test(block[0]),
            'onDismiss must NOT call pauseCloudUpload (that is the bug we are fixing)'
        );
    }

});

console.log('🧪 SyncRegression tests cargados.');
