import { icons } from '../ui/IconSystem.js';
export const UndoManager = {
    _pending: null,
    _timer: null,
    _element: null,
    _dependencies: {
        saveFn: null,
        renderFn: null,
        showNotificationFn: null
    },

    /**
     * Inicializa el UndoManager con las funciones necesarias
     * @param {object} dependencies - { saveFn, renderFn, showNotificationFn }
     */
    init({ saveFn, renderFn, showNotificationFn }) {
        this._dependencies.saveFn = saveFn;
        this._dependencies.renderFn = renderFn;
        this._dependencies.showNotificationFn = showNotificationFn;

        // Exponer globalmente para que funcione el onclick="UndoManager.undo()"
        window.UndoManager = this;
    },

    /**
     * Registra una acción deshacer.
     * @param {object|null} snapshot - Estado ANTES del cambio
     * @param {string} label         - Texto descriptivo: "Asistencia de Juan"
     * @param {function} restoreFn   - Función que restaura el estado previo
     */
    push(snapshot, label, restoreFn) {
        // Si hay uno pendiente, lo consolida (solo 1 undo activo a la vez)
        if (this._pending) {
            this._dismiss();
        }

        this._pending = { snapshot, label, restoreFn };
        this._show(label);

        // Auto-eliminar después de 5 segundos
        this._timer = setTimeout(() => {
            this._dismiss();
        }, 5000);
    },

    // Ejecutar el deshacer
    undo() {
        if (!this._pending) return;

        const { restoreFn, label } = this._pending;
        clearTimeout(this._timer);
        this._pending = null;
        this._dismiss();

        // Ejecutar la restauración
        restoreFn();

        // Guardar y renderizar usando dependencias inyectadas
        if (this._dependencies.saveFn) this._dependencies.saveFn();
        if (this._dependencies.renderFn) this._dependencies.renderFn();

        if (this._dependencies.showNotificationFn) {
            this._dependencies.showNotificationFn(`↩️ Deshecho: ${label}`, 'info');
        }
    },

    // Mostrar el botón flotante
    _show(label) {
        if (this._element) this._element.remove();

        const el = document.createElement('div');
        el.id = 'undo-toast';
        el.innerHTML = `
                    <div class="undo-toast-inner">
                        <span class="undo-toast-icon">↩️</span>
                        <span class="undo-toast-text">Deshacer: ${label}</span>
                        <button class="undo-toast-btn" onclick="UndoManager.undo()">DESHACER</button>
                        <button class="undo-toast-close" onclick="UndoManager._dismiss()">${icons.get('close')}</button>
                    </div>
                `;

        document.body.appendChild(el);
        this._element = el;

        // Trigger animación de entrada (necesita 2 frames para que el browser registre el estado inicial)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                el.classList.add('visible');
            });
        });
    },

    // Quitar el botón con animación de salida
    _dismiss() {
        clearTimeout(this._timer);
        if (this._element) {
            this._element.classList.remove('visible');
            const el = this._element;
            this._element = null;
            setTimeout(() => el.remove(), 350);
        }
        this._pending = null;
    }
};
