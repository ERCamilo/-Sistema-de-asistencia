/**
 * 💡 HelpTooltip.js — Botón (?) que despliega ayuda contextual
 *
 * Uso simple:
 *   `<label>Tarifa por hora ${HelpTooltip.render('position.hourlyRate')}</label>`
 *
 * El botón se renderiza con la clase `.help-tooltip-btn` y el sistema de
 * event delegation lo intercepta automáticamente (data-help-key).
 *
 * Auto-show en focus:
 *   Asociar un input al tooltip con `data-help-on-focus="clave"` y al enfocarlo
 *   se mostrará automáticamente si el modo lo permite.
 */

import { Modal } from './Modal.js';
import { HELP_TEXTS } from './helpTexts.js';
import { HelpController } from './HelpController.js';
import { state } from '../core/AppState.js';

// ─────────────────────────────────────────────────────────────
// Singleton del controller (inicializado al cargar el módulo)
// ─────────────────────────────────────────────────────────────

// Asegurar que state.helpSeen exista (idempotente)
if (!state.helpSeen) state.helpSeen = {};
if (!state.settings) state.settings = {};
if (!state.settings.helpMode) state.settings.helpMode = 'first-time';

const controller = new HelpController({
    getSettings: () => state.settings,
    getSeenMap: () => state.helpSeen,
    persist: () => {
        // En esta app, los settings se guardan vía saveApplicationData.
        // Para no acoplar fuertemente, dejamos que el save se dispare por otros eventos.
        // Si en el futuro queremos persistencia inmediata, llamar saveApplicationData aquí.
    }
});

// Exponer el controller para que pueda usarse desde Ajustes
if (typeof window !== 'undefined') {
    window.helpController = controller;
}

// ─────────────────────────────────────────────────────────────
// API estática (igual que Modal.confirm/alert)
// ─────────────────────────────────────────────────────────────

export const HelpTooltip = {
    /**
     * Renderiza el botón (?) como string HTML para incrustar en plantillas.
     * @param {string} key - clave del helpText
     * @returns {string} HTML del botón, o '' si la clave no existe
     */
    render(key) {
        if (!HELP_TEXTS[key]) return '';
        const safeKey = key.replace(/"/g, '&quot;');
        const ariaLabel = `Ayuda sobre ${HELP_TEXTS[key].title.replace(/"/g, '&quot;')}`;
        return `<button type="button" class="help-tooltip-btn"
                    data-help-key="${safeKey}"
                    aria-label="${ariaLabel}"
                    style="display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; margin-left: 6px; border-radius: 50%; border: 1px solid #475569; background: rgba(100, 116, 139, 0.15); color: #94a3b8; font-size: 0.7rem; font-weight: 700; cursor: pointer; vertical-align: middle; transition: all 0.15s;">?</button>`;
    },

    /**
     * Muestra el tooltip de una clave específica. Llamable desde código.
     * Si la clave no existe, no hace nada.
     * @param {string} key
     */
    show(key) {
        const help = HELP_TEXTS[key];
        if (!help) return;

        controller.markSeen(key);

        // Convertir saltos de línea del body a <br> para renderizado
        const safeBody = String(help.body)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

        Modal.alert({
            title: help.title,
            message: safeBody,
            buttonText: 'Entendido'
        });
    },

    /**
     * Hook para input focus: muestra el tooltip si shouldAutoShow es true.
     * @param {string} key
     */
    autoShowOnFocus(key) {
        if (controller.shouldAutoShow(key)) {
            HelpTooltip.show(key);
        }
    },

    /**
     * Acceso al controller para configuración (modo, reset, etc.)
     */
    controller
};

// ─────────────────────────────────────────────────────────────
// Event Delegation: clic en el botón (?) abre el tooltip
// ─────────────────────────────────────────────────────────────

let _delegationAttached = false;
if (typeof document !== 'undefined' && !_delegationAttached) {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-help-key]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        HelpTooltip.show(btn.dataset.helpKey);
    });

    // Auto-show on focus para inputs con data-help-on-focus
    document.addEventListener('focusin', (e) => {
        const target = e.target;
        if (!target || !target.dataset) return;
        const helpKey = target.dataset.helpOnFocus;
        if (!helpKey) return;
        // Pequeño delay para no competir con el render del foco
        setTimeout(() => HelpTooltip.autoShowOnFocus(helpKey), 100);
    });

    _delegationAttached = true;
}
