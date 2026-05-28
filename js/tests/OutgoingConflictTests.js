/**
 * 🧪 OutgoingConflictTests
 *
 * Contract for the outgoing-conflict guard:
 *
 *   SCENARIO: Device A has local data (localUpdatedAt = T_a).
 *             Device B writes to cloud   (cloud's localUpdatedAt = T_b, T_b > T_a + GRACE).
 *             Device A's debounced save fires before the user accepts the incoming
 *             change modal → WITHOUT the guard, Device A would silently overwrite T_b.
 *             WITH the guard:
 *               - Firebase push is skipped.
 *               - eventBus emits 'sync:outgoing-conflict' {localTime, cloudTime}.
 *               - app.js shows Modal.confirm asking the user.
 *               - If confirmed → force push (local wins).
 *               - If cancelled  → don't push (cloud wins, wait for incoming detection).
 *
 * Contracts:
 *   PersistenceService._executeSave:
 *     - Must track and compare _lastKnownCloudUpdatedAt before Firebase sync.
 *     - Must emit 'sync:outgoing-conflict' via globalThis.eventBus when conflict.
 *     - Must skip Firebase when hasOutgoingConflict (and _outgoingConflictReviewPending).
 *     - Must NOT skip when options.force = true.
 *     - Must NOT skip when options.localOnly = true (Firebase is already skipped).
 *
 *   app.js:
 *     - Must track state._lastKnownCloudUpdatedAt from subscribeToChanges.
 *     - Must listen for 'sync:outgoing-conflict'.
 *     - Near that listener, must call Modal.confirm.
 *     - If confirmed → saveApplicationData({force:true}) so local wins.
 *     - Must clear state._outgoingConflictReviewPending after responding.
 */

import fs from 'fs';
import path from 'path';
import { state } from '../modules/core/AppState.js';

const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// PersistenceService — source-level contracts
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("OutgoingConflict — PersistenceService (source checks)", {

    "_executeSave references _lastKnownCloudUpdatedAt"() {
        testRunner.assert(
            /_lastKnownCloudUpdatedAt/.test(PERSISTENCE_SRC),
            'PersistenceService must read state._lastKnownCloudUpdatedAt for conflict detection'
        );
    },

    "_executeSave emits sync:outgoing-conflict via eventBus"() {
        testRunner.assert(
            /sync:outgoing-conflict/.test(PERSISTENCE_SRC),
            "PersistenceService must emit 'sync:outgoing-conflict' when cloud is newer than local"
        );
    },

    "_executeSave has an outgoing conflict grace period constant"() {
        // A numeric constant (ms) separating "same-session echo" from "real conflict"
        testRunner.assert(
            /CONFLICT_GRACE|OUTGOING_CONFLICT_GRACE|GRACE_MS|grace/i.test(PERSISTENCE_SRC),
            'PersistenceService must define a grace-period constant to avoid race-condition false positives'
        );
    },

    "Firebase sync block is guarded so it skips when conflict is pending"() {
        // The Firebase block condition must include a check that prevents the push
        // when a conflict review is pending.
        testRunner.assert(
            /_hasOutgoingConflict|_outgoingConflictReviewPending|outgoingConflict/.test(PERSISTENCE_SRC),
            'Firebase sync block must be guarded against outgoing conflicts'
        );
    },

    "force:true bypasses the outgoing conflict check"() {
        // When options.force = true the caller explicitly wants to override,
        // so the conflict check must respect that.
        const block = PERSISTENCE_SRC.match(/_hasOutgoingConflict[\s\S]{0,200}/);
        testRunner.assert(
            block ? /options\.force/.test(block[0]) : /options\.force.*outgoing|outgoing.*options\.force/.test(PERSISTENCE_SRC),
            'Outgoing conflict check must be bypassed when options.force = true'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js — source-level contracts
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("OutgoingConflict — app.js (source checks)", {

    "subscribeToChanges tracks _lastKnownCloudUpdatedAt"() {
        // Inside the subscribeToChanges callback, app.js must save the cloud's
        // localUpdatedAt so PersistenceService can compare it on the next save.
        testRunner.assert(
            /_lastKnownCloudUpdatedAt/.test(APP_SRC),
            'app.js must assign state._lastKnownCloudUpdatedAt inside subscribeToChanges'
        );
    },

    "app.js listens for sync:outgoing-conflict event"() {
        testRunner.assert(
            /sync:outgoing-conflict/.test(APP_SRC),
            "app.js must register an eventBus.on('sync:outgoing-conflict', ...) handler"
        );
    },

    "app.js calls Modal.confirm in the outgoing-conflict handler"() {
        // The handler can be arbitrarily long (e.g. multi-line Spanish messages),
        // so search up to 3000 chars from the event-name string.
        const block = APP_SRC.match(/sync:outgoing-conflict[\s\S]{0,3000}/);
        testRunner.assert(
            !!block && /Modal\.confirm/.test(block[0]),
            'outgoing-conflict handler must call Modal.confirm to ask the user'
        );
    },

    "if user confirms, app.js calls saveApplicationData with force:true"() {
        // saveApplicationData comes after Modal.confirm resolves, so the window
        // needs to cover the full handler body (message + confirm + conditional).
        const block = APP_SRC.match(/sync:outgoing-conflict[\s\S]{0,3000}/);
        testRunner.assert(
            !!block && /saveApplicationData\s*\(\s*\{[^}]*force\s*:\s*true/.test(block[0]),
            'After user confirms, handler must call saveApplicationData({force:true})'
        );
    },

    "handler clears _outgoingConflictReviewPending after responding"() {
        testRunner.assert(
            /_outgoingConflictReviewPending\s*=\s*false/.test(APP_SRC),
            'Handler must clear _outgoingConflictReviewPending so future conflicts can show again'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// AppState — _lastKnownCloudUpdatedAt does not pollute state defaults
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("OutgoingConflict — state flag isolation", {

    "state does not pre-define _lastKnownCloudUpdatedAt (runtime-only)"() {
        // It is set at runtime from subscribeToChanges.
        // The default state should NOT have it pre-set to avoid stale values surviving reloads.
        testRunner.assert(
            !Object.prototype.hasOwnProperty.call(state, '_lastKnownCloudUpdatedAt'),
            'state._lastKnownCloudUpdatedAt must be a runtime-only flag, not pre-defined in AppState'
        );
    },

    "state does not pre-define _outgoingConflictReviewPending"() {
        testRunner.assert(
            !Object.prototype.hasOwnProperty.call(state, '_outgoingConflictReviewPending'),
            'state._outgoingConflictReviewPending must be a runtime-only flag'
        );
    }

});

console.log('🧪 OutgoingConflict tests cargados.');
