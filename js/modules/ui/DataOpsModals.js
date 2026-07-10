/**
 * 🎨 DataOpsModals.js (Fase 0.5, U7a)
 *
 * Modal rico de confirmación para las operaciones de datos (Descargar y
 * Reemplazar, Subir y Reemplazar, Borrar Local, Borrar Nube). La capa de
 * presentación de DataOps: dice la VERDAD con un flujo visual de iconos
 * (nube → disquete = descargar, equipo → nube = subir, tacho = borrar),
 * bullets de qué va a pasar exactamente, checkboxes para las opciones y
 * confirmación tipeada para las destructivas — todo en UN modal en vez de
 * 3-4 diálogos encadenados.
 */

import { Modal } from '../components/Modal.js';
import icons from './IconSystem.js';

// Flujos visuales soportados: [iconoOrigen, flecha?, iconoDestino].
// 'save' es el disquete (💾) — la representación de "este equipo/lo local".
const FLOWS = {
    'cloud-to-device': { from: 'cloud', to: 'save', arrow: true },
    'device-to-cloud': { from: 'save', to: 'cloud', arrow: true },
    'delete-local':    { from: 'save', to: 'delete', arrow: false },
    'delete-cloud':    { from: 'cloud', to: 'delete', arrow: false }
};

function _escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _flowHtml(flowKey) {
    const flow = FLOWS[flowKey];
    if (!flow) return '';
    const arrow = flow.arrow
        ? '<span class="dataops-flow-arrow" style="font-size: 1.6rem; color: #64748b;">➜</span>'
        : '<span class="dataops-flow-arrow" style="font-size: 1.6rem; color: #ef4444;">✕</span>';
    return `
        <div class="dataops-flow" data-flow="${flowKey}"
             style="display: flex; align-items: center; justify-content: center; gap: 18px;
                    padding: 14px 0 18px; font-size: 2.2rem; line-height: 1;">
            <span class="dataops-flow-icon">${icons.get(flow.from)}</span>
            ${arrow}
            <span class="dataops-flow-icon">${icons.get(flow.to)}</span>
        </div>
    `;
}

/**
 * Muestra el modal de confirmación de una operación de datos.
 *
 * @param {{
 *   title: string,
 *   flow: 'cloud-to-device'|'device-to-cloud'|'delete-local'|'delete-cloud',
 *   bullets: string[],           // qué va a pasar, EXACTAMENTE, en lenguaje claro
 *   confirmText?: string,
 *   cancelText?: string,
 *   checkboxes?: Array<{id: string, label: string, checked?: boolean}>,
 *   requireTyping?: string       // texto exacto a tipear para habilitar confirmar
 * }} options
 * @returns {Promise<null | Object<string, boolean>>} null si canceló;
 *   objeto {checkboxId: boolean} si confirmó ({} sin checkboxes).
 */
export function confirmDataOperation(options = {}) {
    return new Promise((resolve) => {
        const bullets = (options.bullets || [])
            .map(b => `<li style="margin: 4px 0;">${_escapeHtml(b)}</li>`)
            .join('');

        const checkboxes = (options.checkboxes || []).map(c => `
            <label class="dataops-check" style="display: flex; align-items: flex-start; gap: 8px;
                   margin: 8px 0; color: #cbd5e1; font-size: 0.9rem; cursor: pointer;">
                <input type="checkbox" data-check-id="${_escapeHtml(c.id)}" ${c.checked ? 'checked' : ''}
                       style="margin-top: 3px; accent-color: #3b82f6;">
                <span>${_escapeHtml(c.label)}</span>
            </label>
        `).join('');

        const typing = options.requireTyping ? `
            <div style="margin-top: 14px;">
                <div style="color: #f87171; font-size: 0.85rem; margin-bottom: 6px;">
                    Para confirmar escribe exactamente: <strong>${_escapeHtml(options.requireTyping)}</strong>
                </div>
                <input type="text" class="dataops-typing form-input" placeholder="${_escapeHtml(options.requireTyping)}"
                       autocomplete="off"
                       style="width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #334155;
                              border-radius: 8px; color: #e2e8f0; font-size: 0.95rem; font-family: monospace;">
            </div>
        ` : '';

        const content = `
            ${_flowHtml(options.flow)}
            <ul class="dataops-bullets" style="color: #94a3b8; line-height: 1.55; margin: 0 0 4px;
                   padding-left: 20px; font-size: 0.92rem;">
                ${bullets}
            </ul>
            ${checkboxes ? `<div class="dataops-checks" style="margin-top: 12px;">${checkboxes}</div>` : ''}
            ${typing}
        `;

        const modal = new Modal({
            title: options.title || '¿Confirmar operación?',
            content,
            size: 'small',
            onOpen: function () {
                if (!options.requireTyping) return;
                const input = this.element.querySelector('.dataops-typing');
                const btns = this.element.querySelectorAll('.modal-btn');
                const confirmBtn = btns[btns.length - 1];
                if (!input || !confirmBtn) return;
                confirmBtn.disabled = true;
                input.addEventListener('input', () => {
                    confirmBtn.disabled = input.value.trim() !== options.requireTyping;
                });
                setTimeout(() => input.focus(), 50);
            },
            onClose: () => {
                if (!modal._resolved) {
                    modal._resolved = true;
                    resolve(null);
                }
            },
            buttons: [
                {
                    text: options.cancelText || 'Cancelar',
                    class: 'btn-secondary',
                    onClick: function () {
                        modal._resolved = true;
                        this.close();
                        resolve(null);
                    }
                },
                {
                    text: options.confirmText || 'Confirmar',
                    class: 'btn-danger',
                    onClick: function () {
                        // Cinturón y tiradores: el listener de arriba ya
                        // deshabilita el botón, pero un Enter/submit raro no
                        // debe poder saltarse la confirmación tipeada.
                        if (options.requireTyping) {
                            const input = this.element.querySelector('.dataops-typing');
                            if (!input || input.value.trim() !== options.requireTyping) return;
                        }
                        const values = {};
                        this.element.querySelectorAll('input[data-check-id]').forEach(box => {
                            values[box.dataset.checkId] = box.checked;
                        });
                        modal._resolved = true;
                        this.close();
                        resolve(values);
                    }
                }
            ]
        });
        modal.open();
    });
}

export default { confirmDataOperation };
