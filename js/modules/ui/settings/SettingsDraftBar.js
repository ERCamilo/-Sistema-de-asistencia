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
 */

export const SETTINGS_DRAFT_BAR_ID = 'settings-draft-bar';

/**
 * Inputs del formulario de Ajustes que son borrador hasta "Guardar
 * Configuración" (los mismos que lee window.saveSettings del DOM). Los
 * switches auto-save (legacyNavigation, hideDuplicateAlerts, weatherEnabled)
 * NO están acá: se cometen solos vía commitAutoSaveSwitch (SettingsUI.js).
 */
export const SETTINGS_DRAFT_FIELD_IDS = [
    'companyName',
    'weatherApiKey',
    'weatherLocationInput',
    'scrollbarMode',
    'iconSet',
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
 * Descarta el borrador: re-renderiza (el formulario se reconstruye desde
 * state, la única fuente de verdad) y oculta la barra.
 * @param {object} [args]
 * @param {Document} [args.doc]
 * @param {Function} [args.render] override para test (default: window.render)
 */
export function discardSettingsDraft({ doc = document, render } = {}) {
    const doRender = render || (typeof window !== 'undefined' ? window.render : null);
    if (typeof doRender === 'function') doRender();
    refreshSettingsDraftBar(doc);
}

export default {
    SETTINGS_DRAFT_BAR_ID,
    SETTINGS_DRAFT_FIELD_IDS,
    isSettingsDraftDirty,
    refreshSettingsDraftBar,
    discardSettingsDraft
};
