/**
 * SettingsDraftBar.js — barra pegajosa de "cambios sin guardar" en Ajustes.
 *
 * Los inputs validados del formulario de Ajustes son BORRADOR en el DOM hasta
 * que el usuario confirma con "Guardar Configuración" (ver la convención de
 * controles en SettingsUI.js). El botón de guardar queda al fondo de la
 * pantalla, así que un draft editado era invisible: el usuario cambiaba de
 * pestaña o cerraba sin enterarse de que no guardó. Esta barra hace visible
 * ese estado — aparece fija abajo cuando hay diferencias entre lo tipeado y
 * lo guardado, con Guardar (delega en la acción save-settings existente, con
 * su validación) y Descartar (re-render: el DOM vuelve a reflejar state).
 *
 * Detección de sucio SIN mapa campo→state: se compara `value` contra
 * `defaultValue` (y la opción `defaultSelected` en selects). El formulario se
 * renderiza desde state, así que los defaults del DOM SON la línea de base:
 *   - un revert manual vuelve a "limpio" solo (no es un flag pegajoso),
 *   - los defaults siguen los valores guardados tras cada render,
 *   - campos ausentes (otra pestaña activa) simplemente no participan.
 *
 * RenderManager captura los campos editados antes de parchear el DOM y los
 * restaura después. Un cambio externo del mismo campo conserva el borrador
 * y exige una decisión explícita antes de guardarlo.
 *
 * window.render() NUNCA es síncrono: agenda el trabajo real vía
 * renderOptimizer.scheduleRender (requestAnimationFrame) y RenderManager
 * emite 'render:complete' en eventBus cuando ese trabajo terminó de verdad.
 * Por eso la barra se re-evalúa suscribiéndose UNA VEZ a ese evento acá
 * abajo, en vez de refrescarla "a mano" justo después de llamar a render()
 * (ese refresco quedaría mirando el DOM viejo, todavía no parcheado).
 */

import { eventBus } from '../../core/Events.js';

export const SETTINGS_DRAFT_BAR_ID = 'settings-draft-bar';

/**
 * Inputs del formulario de Ajustes que son borrador hasta "Guardar
 * Configuración" (los mismos que lee window.saveSettings del DOM). Los
 * controles auto-commit NO están acá: los switches (legacyNavigation,
 * hideDuplicateAlerts, weatherEnabled, attendancePositionWatermarks) se
 * cometen vía commitAutoSaveSwitch; attendanceWatermarkVisibility y
 * attendanceWatermarkContent vía commitAutoSaveOption (SettingsUI.js), y el
 * select de iconos vía window.commitIconSet (app.js) — aplicar el set YA es
 * su vista previa, así que se comete al elegirlo.
 */
export const SETTINGS_DRAFT_FIELD_IDS = [
    'companyName',
    'weatherApiKey',
    'weatherLocationInput',
    'scrollbarMode',
    'showAttendanceCardDeficit',
    'attendanceDeficitUnit',
    'regularHoursPerDay',
    'overtimeFactor',
    'holidayFactor',
    'restDayFactor',
    'defaultDeductionPercentage'
];

/**
 * ¿Hay algún campo del formulario con un valor distinto al rendereado?
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function isSettingsDraftDirty(doc = document) {
    if (heldFields.size) return true;
    for (const id of SETTINGS_DRAFT_FIELD_IDS) {
        const el = doc.getElementById(id);
        if (!el) continue;
        if (el.type === 'checkbox') {
            if (el.checked !== el.defaultChecked) return true;
        } else if (el.tagName === 'SELECT') {
            const options = Array.from(el.options);
            if (options.length === 0 || el.selectedIndex === -1) continue;
            const defIdx = options.findIndex(o => o.defaultSelected);
            // Sin atributo `selected` el navegador elige la primera opción.
            const baseIdx = defIdx === -1 ? 0 : defIdx;
            if (el.selectedIndex !== baseIdx) return true;
        } else if (el.value !== el.defaultValue) {
            return true;
        }
    }
    return false;
}

// Transient UI metadata only: never persisted or synchronized.
const conflicts = new Map();
const heldFields = new Map();
let scopeConflict = false;

function fieldValue(el, baseline = false) {
    if (el.type === 'checkbox') return baseline ? el.defaultChecked : el.checked;
    if (el.tagName === 'SELECT' && baseline) {
        return Array.from(el.options).find(option => option.defaultSelected)?.value ?? el.options[0]?.value ?? '';
    }
    return baseline ? el.defaultValue : el.value;
}

function writeFieldValue(el, value) {
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
}

function pruneConflicts(doc) {
    for (const id of conflicts.keys()) {
        const el = doc.getElementById(id);
        if ((!el && !heldFields.has(id)) || (el && fieldValue(el) === fieldValue(el, true))) conflicts.delete(id);
    }
}

export function captureSettingsDraft(doc = document) {
    const screen = doc.getElementById('settings-screen');
    if (!screen) return null;
    const fields = SETTINGS_DRAFT_FIELD_IDS.flatMap(id => {
        const el = doc.getElementById(id);
        if (!el || fieldValue(el) === fieldValue(el, true)) return [];
        return [{ id, value: fieldValue(el), base: fieldValue(el, true) }];
    });
    for (const field of heldFields.values()) {
        if (!doc.getElementById(field.id)) fields.push(field);
    }
    const active = doc.activeElement;
    return { scope: screen.dataset.settingsDraftScope, tab: screen.dataset.settingsDraftTab, fields,
        focus: fields.some(field => field.id === active?.id)
            ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null };
}

export function restoreSettingsDraft(snapshot, doc = document) {
    const screen = doc.getElementById('settings-screen');
    if (!snapshot || !screen || screen.dataset.settingsDraftTab !== snapshot.tab) {
        conflicts.clear();
        heldFields.clear();
        scopeConflict = false;
        return;
    }
    if (snapshot.fields.length && screen.dataset.settingsDraftScope !== snapshot.scope) scopeConflict = true;
    for (const field of snapshot.fields) {
        const el = doc.getElementById(field.id);
        // Project configuration may briefly replace the form with a loading panel.
        if (!el) { heldFields.set(field.id, field); continue; }
        heldFields.delete(field.id);
        const remote = fieldValue(el, true);
        if (remote !== field.base && remote !== field.value) conflicts.set(field.id, remote);
        writeFieldValue(el, field.value);
    }
    pruneConflicts(doc);
    if (snapshot.focus) {
        const el = doc.getElementById(snapshot.focus.id);
        if (el) {
            if (doc.activeElement !== el) el.focus({ preventScroll: true });
            if (snapshot.focus.start !== null && el.setSelectionRange) el.setSelectionRange(snapshot.focus.start, snapshot.focus.end);
        }
    }
}

/** A conflict is never silently saved. Re-check after an asynchronous dialog. */
export function guardSettingsDraftBeforeSave({ doc = document, showConfirm, onProceed, getRevision = () => '' } = {}) {
    pruneConflicts(doc);
    if (scopeConflict) {
        window.showNotification?.('Cambió el proyecto. Descarta el borrador antes de guardar.', 'warning');
        return { blocked: true };
    }
    if (!conflicts.size) return { blocked: false };
    const ask = showConfirm || window.showConfirm;
    if (typeof ask !== 'function') {
        window.showNotification?.('Hay cambios de otro dispositivo. Descarta el borrador o resuelve el conflicto antes de guardar.', 'warning');
        return { blocked: true };
    }
    const signature = () => {
        const draft = captureSettingsDraft(doc);
        return JSON.stringify([getRevision(), draft?.scope, draft?.tab, draft?.fields, [...conflicts]]);
    };
    const before = signature();
    ask({
        title: 'Ajustes modificados en otro dispositivo',
        message: 'Tu borrador se conserva. Guardarlo reemplazará los valores nuevos de los campos que editaste. Puedes cancelar y pulsar Descartar para usar los valores actuales.',
        confirmText: 'Guardar mi borrador', cancelText: 'Seguir revisando', type: 'warning',
        onConfirm: () => {
            if (signature() !== before) {
                window.showNotification?.('Los ajustes cambiaron mientras confirmabas. Revisa los cambios y vuelve a guardar.', 'warning');
                return;
            }
            conflicts.clear();
            onProceed?.();
        }
    });
    return { blocked: true };
}

function _ensureBar(doc) {
    let bar = doc.getElementById(SETTINGS_DRAFT_BAR_ID);
    if (bar) return bar;

    bar = doc.createElement('div');
    bar.id = SETTINGS_DRAFT_BAR_ID;
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
        <span data-settings-draft-message>
            Hay cambios sin guardar
        </span>
        <button type="button" class="btn btn-primary" data-settings-action="save-settings"
                style="padding: 6px 16px; font-size: 0.85rem;">
            Guardar cambios
        </button>
        <button type="button" class="btn" data-settings-action="discard-settings-draft"
                style="padding: 6px 16px; font-size: 0.85rem;">
            Descartar
        </button>
    `;
    doc.body.appendChild(bar);
    return bar;
}

/**
 * Recalcula el estado del draft y muestra/oculta la barra. Idempotente:
 * garantiza una única barra por documento.
 * @param {Document} [doc]
 * @returns {boolean} el estado sucio calculado (útil para guards de salida)
 */
export function refreshSettingsDraftBar(doc = document) {
    const bar = _ensureBar(doc);
    const dirty = isSettingsDraftDirty(doc);
    pruneConflicts(doc);
    const visible = dirty || scopeConflict;
    bar.hidden = !visible;
    bar.style.display = visible ? 'flex' : 'none';
    const message = bar.querySelector('[data-settings-draft-message]');
    if (message) message.textContent = scopeConflict
        ? 'Cambió el proyecto. Descarta el borrador para editar el proyecto actual.'
        : conflicts.size ? 'Estos ajustes cambiaron en otro dispositivo. Tu borrador se conserva.'
        : 'Hay cambios sin guardar · Descartar solo revierte lo que aún no guardaste';
    return dirty;
}

/**
 * Oculta la barra de inmediato, sin recalcular el estado sucio. Para casos
 * donde el draft se descarta ANTES de que exista un render nuevo que
 * reevaluar (p.ej. el guard de salida: la navegación solo se AGENDA, no
 * ocurre en el mismo tick) — esperar a 'render:complete' dejaría la barra
 * flotando sobre una pantalla ya distinta.
 * @param {Document} [doc]
 */
export function hideSettingsDraftBar(doc = document) {
    const bar = doc.getElementById(SETTINGS_DRAFT_BAR_ID);
    if (!bar) return;
    bar.hidden = true;
    bar.style.display = 'none';
}

/**
 * Descarta el borrador devolviendo cada campo a su valor rendereado
 * (defaultValue / defaultSelected) y oculta la barra.
 *
 * El reset es EXPLÍCITO sobre el DOM, no vía render(): con state sin cambios
 * el HTML nuevo es idéntico al viejo y DOMDiff saltea los nodos por
 * isEqualNode (compara atributos, no el `.value` vivo) — un render jamás
 * borraría lo tipeado (field test 2026-07-19: "Descartar" parecía una
 * etiqueta muerta).
 * @param {object} [args]
 * @param {Document} [args.doc]
 */
export function discardSettingsDraft({ doc = document } = {}) {
    conflicts.clear();
    heldFields.clear();
    scopeConflict = false;
    for (const id of SETTINGS_DRAFT_FIELD_IDS) {
        const el = doc.getElementById(id);
        if (!el) continue;
        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = el.defaultChecked;
        } else if (el.tagName === 'SELECT') {
            const options = Array.from(el.options);
            if (options.length === 0) continue;
            const defIdx = options.findIndex(o => o.defaultSelected);
            el.selectedIndex = defIdx === -1 ? 0 : defIdx;
        } else {
            el.value = el.defaultValue;
        }
    }
    hideSettingsDraftBar(doc);
}

/**
 * Guard de salida: si hay draft sucio, pregunta antes de navegar (cambiar de
 * sub-pestaña de Ajustes o salir de la pantalla re-renderiza el formulario
 * desde state y pisa el draft en silencio). Caso borde — la barra pegajosa
 * es el aviso principal.
 *
 * Nunca BLOQUEA: sin confirm disponible, navega igual (mejor perder un draft
 * que dejar al usuario atrapado en Ajustes).
 *
 * @param {object} [args]
 * @param {Document} [args.doc]
 * @param {Function} [args.showConfirm] default: window.showConfirm
 * @param {Function} [args.onProceed] la navegación a ejecutar (diferida si se pregunta)
 * @returns {{asked: boolean}}
 */
export function guardSettingsDraftOnLeave({ doc = document, showConfirm, onProceed } = {}) {
    const ask = showConfirm
        || (typeof window !== 'undefined' ? window.showConfirm : null);

    if (!isSettingsDraftDirty(doc) || typeof ask !== 'function') {
        onProceed?.();
        return { asked: false };
    }

    ask({
        title: 'Cambios sin guardar',
        message: 'Hay cambios en la configuración que todavía no se guardaron. Si sales ahora, se descartarán.',
        confirmText: 'Salir y descartar',
        cancelText: 'Quedarme',
        type: 'warning',
        onConfirm: () => {
            // onProceed solo AGENDA la navegación (setTimeout/render async) —
            // no toca el DOM en este mismo tick. Ocultar la barra ya mismo en
            // vez de refrescarla contra el DOM viejo (todavía sin navegar).
            discardSettingsDraft({ doc });
            onProceed?.();
        }
    });
    return { asked: true };
}

// Re-evalúa la barra después de CADA render completado de verdad (ver nota
// arriba: window.render() nunca es síncrono). Suscripción única a nivel de
// módulo — barato (isSettingsDraftDirty recorre ~9 getElementById).
eventBus.on('render:complete', () => refreshSettingsDraftBar(document));

export default {
    SETTINGS_DRAFT_BAR_ID,
    SETTINGS_DRAFT_FIELD_IDS,
    isSettingsDraftDirty,
    refreshSettingsDraftBar,
    hideSettingsDraftBar,
    discardSettingsDraft,
    guardSettingsDraftOnLeave
};
