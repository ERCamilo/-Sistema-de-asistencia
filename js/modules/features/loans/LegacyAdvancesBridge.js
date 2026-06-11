/**
 * 💵 LegacyAdvancesBridge — handlers for the legacy `emp.advances[]` UI.
 *
 * The in-profile Nómina tab (ProfileTabs.js) renders an inline advances
 * editor that talks to `state.employeeProfile.advances`. Those handlers
 * used to live as duplicated definitions in app.js. They are kept around
 * to support the existing UI while the new Cuentas-por-Cobrar view
 * (LoansLedger) ramps up — both UIs coexist for now.
 *
 * Design:
 *  - Pure helpers below operate on a `scratch` object with shape
 *    `{ advances: [...], editingAdvances: {...} }`. No state import,
 *    no DOM, no side effects → trivial to unit-test.
 *  - The window-bound handlers (registerLegacyGlobals) are thin wrappers
 *    that pass `state.employeeProfile` into the helpers, then call
 *    syncProfileToMaster + refresh the payroll UI.
 */

import { state } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { syncProfileToMaster } from '../profile/index.js';
import { recordNestedTombstone } from '../../services/NestedTombstones.js';

// ─── ID generator (kept compatible with the legacy ADV-{ts} format) ──────────

let _advCounter = 0;
function genAdvId() {
    _advCounter++;
    return `ADV-${Date.now()}-${_advCounter}`;
}

// ─── Pure helpers (testable in isolation) ────────────────────────────────────

/**
 * Append a new blank advance to scratch.advances and auto-open it in edit mode.
 * @param {object} scratch  the profile scratch object (has .advances, .editingAdvances)
 * @param {string} todayKey 'YYYY-MM-DD' to seed the date
 * @returns {object} the newly appended advance
 */
export function addAdvanceTo(scratch, todayKey) {
    if (!scratch) return null;
    if (!Array.isArray(scratch.advances)) scratch.advances = [];
    const newIndex = scratch.advances.length;
    const entry = {
        id: genAdvId(),
        amount: 0,
        date: todayKey,
        interest: 0,
        note: ''
    };
    scratch.advances.push(entry);
    setEditing(scratch, newIndex);
    return entry;
}

export function removeAdvanceAt(scratch, index) {
    if (!scratch || !Array.isArray(scratch.advances)) return;
    if (index < 0 || index >= scratch.advances.length) return;
    // 🪦 P1: tombstone antes del splice — sin esto el merge con la nube
    // resucitaba el adelanto borrado desde la copia remota.
    const deleted = scratch.advances[index];
    if (deleted?.id) recordNestedTombstone(scratch, 'advances', deleted.id);
    scratch.advances.splice(index, 1);
    // Also reset the matching editing flag so we don't leak orphan true-states
    if (scratch.editingAdvances) {
        delete scratch.editingAdvances[index];
    }
}

/**
 * Update one field on the advance at `index`. Numeric fields are coerced
 * and negative values clamped to 0.
 */
export function updateAdvanceField(scratch, index, field, value) {
    if (!scratch || !Array.isArray(scratch.advances)) return;
    const adv = scratch.advances[index];
    if (!adv) return;

    if (field === 'amount' || field === 'interest') {
        const n = parseFloat(value);
        adv[field] = Number.isFinite(n) && n >= 0 ? n : 0;
    } else if (field === 'date' || field === 'note') {
        adv[field] = String(value ?? '');
    }
}

export function setEditing(scratch, index) {
    if (!scratch) return;
    if (!scratch.editingAdvances) scratch.editingAdvances = {};
    scratch.editingAdvances[index] = true;
}

export function clearEditing(scratch, index) {
    if (!scratch || !scratch.editingAdvances) return;
    scratch.editingAdvances[index] = false;
}

export function isEditing(scratch, index) {
    if (!scratch || !scratch.editingAdvances) return false;
    return !!scratch.editingAdvances[index];
}

// ─── Side-effectful handlers (bound to window for data-app-fn dispatch) ──────

function refreshPayrollUI() {
    if (typeof window !== 'undefined' && typeof window.updatePayrollUI === 'function') {
        window.updatePayrollUI();
    } else {
        render();
    }
}

function notify(msg, type = 'info') {
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(msg, type);
    }
}

export function addAdvance() {
    const profile = state.employeeProfile;
    if (!profile) return;
    addAdvanceTo(profile, getDateKey(new Date()));
    syncProfileToMaster(profile.employeeId);
    refreshPayrollUI();
}

export function removeAdvance(index) {
    const profile = state.employeeProfile;
    if (!profile) return;
    removeAdvanceAt(profile, parseInt(index, 10));
    syncProfileToMaster(profile.employeeId);
    refreshPayrollUI();
}

export function updateAdvanceValue(index, value) {
    updateAdvanceField(state.employeeProfile, parseInt(index, 10), 'amount', value);
    syncProfileToMaster(state.employeeProfile?.employeeId);
    refreshPayrollUI();
}

export function updateAdvanceDate(index, value) {
    updateAdvanceField(state.employeeProfile, parseInt(index, 10), 'date', value);
    syncProfileToMaster(state.employeeProfile?.employeeId);
    refreshPayrollUI();
}

export function updateAdvanceInterest(index, value) {
    updateAdvanceField(state.employeeProfile, parseInt(index, 10), 'interest', value);
    syncProfileToMaster(state.employeeProfile?.employeeId);
    refreshPayrollUI();
}

export function updateAdvanceNote(index, value) {
    updateAdvanceField(state.employeeProfile, parseInt(index, 10), 'note', value);
    syncProfileToMaster(state.employeeProfile?.employeeId);
    refreshPayrollUI();
}

export function editAdvance(index) {
    setEditing(state.employeeProfile, parseInt(index, 10));
    render();
}

export function saveAdvance(index) {
    clearEditing(state.employeeProfile, parseInt(index, 10));
    // Toast honesto con el resultado real (lo emite el SaveOutcomeNotifier).
    syncProfileToMaster(state.employeeProfile?.employeeId, { announce: 'Adelanto guardado' });
    refreshPayrollUI();
}

/**
 * Bind the side-effectful handlers to window.* so existing data-app-fn
 * buttons in the legacy profile-modal Nómina tab keep working.
 */
export function registerLegacyGlobals() {
    if (typeof window === 'undefined') return;
    window.addAdvance = addAdvance;
    window.removeAdvance = removeAdvance;
    window.updateAdvanceValue = updateAdvanceValue;
    window.updateAdvanceDate = updateAdvanceDate;
    window.updateAdvanceInterest = updateAdvanceInterest;
    window.updateAdvanceNote = updateAdvanceNote;
    window.editAdvance = editAdvance;
    window.saveAdvance = saveAdvance;
}
