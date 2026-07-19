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
 *   - cualquier re-render reconstruye los defaults y resetea la base,
 *   - campos ausentes (otra pestaña activa) simplemente no participan.
 *
 * Limitación conocida: un re-render de fondo (p.ej. sync entrante de otro
 * dispositivo) reconstruye el formulario desde state y PISA el draft tipeado
 * — eso ya pasaba antes de esta barra (los drafts viven solo en el DOM). La
 * barra al menos deja de mentir: al reconstruirse el DOM queda limpio y se
 * oculta en el próximo refresh.
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
 * hideDuplicateAlerts, weatherEnabled) se cometen vía commitAutoSaveSwitch
 * (SettingsUI.js) y el select de iconos vía window.commitIconSet (app.js) —
 * aplicar el set YA es su vista previa, así que se comete al elegirlo.
 */
export const SETTINGS_DRAFT_FIELD_IDS = [
    'companyName',
    'weatherApiKey',
    'weatherLocationInput',
    'scrollbarMode',
    'regularHoursPerDay',
    'overtimeFactor',
    'holidayFactor',
    'defaultDeductionPercentage'
];

/**
 * ¿Hay algún campo del formulario con un valor distinto al rendereado?
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function isSettingsDraftDirty(doc = document) {
    for (const id of SETTINGS_DRAFT_FIELD_IDS) {
        const el = doc.getElementById(id);
        if (!el) continue;
        if (el.tagName === 'SELECT') {
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

function _ensureBar(doc) {
    let bar = doc.getElementById(SETTINGS_DRAFT_BAR_ID);
    if (bar) return bar;

    bar = doc.createElement('div');
    bar.id = SETTINGS_DRAFT_BAR_ID;
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
        'position: fixed',
        'left: 50%',
        'bottom: 16px',
        'transform: translateX(-50%)',
        'z-index: 1200',
        'align-items: center',
        'gap: 12px',
        'padding: 10px 16px',
        'border-radius: 10px',
        'background: #1e293b',
        'border: 1px solid #334155',
        'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35)',
        'max-width: calc(100vw - 32px)'
    ].join('; ');
    bar.innerHTML = `
        <span style="color: #e2e8f0; font-size: 0.85rem; white-space: nowrap;">
            Hay cambios sin guardar
        </span>
        <button type="button" class="btn btn-primary" data-settings-action="save-settings"
                style="padding: 6px 16px; font-size: 0.85rem;">
            Guardar
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
    bar.hidden = !dirty;
    bar.style.display = dirty ? 'flex' : 'none';
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
    for (const id of SETTINGS_DRAFT_FIELD_IDS) {
        const el = doc.getElementById(id);
        if (!el) continue;
        if (el.tagName === 'SELECT') {
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
            hideSettingsDraftBar(doc);
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
