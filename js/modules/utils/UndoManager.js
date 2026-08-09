import icons from '../ui/IconSystem.js';
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

        // Expuesto globalmente para acceso desde otros módulos legacy
        window.UndoManager = this;
    },

    /**
     * Registra una acción deshacer.
     * @param {object|null} snapshot - Estado ANTES del cambio
     * @param {string} label         - Texto descriptivo: "Asistencia de Juan"
     * @param {function} restoreFn   - Función que restaura el estado previo
     */
    push(snapshot, label, restoreFn, options = {}) {
        // Si hay uno pendiente, lo consolida (solo 1 undo activo a la vez)
        if (this._pending) {
            this._dismiss();
        }

        this._pending = { snapshot, label, restoreFn, options };
        this._show(label);

        const timeoutMs = Math.max(0, Number(options.timeoutMs) || 5000);
        // Auto-eliminar después de la ventana solicitada (5 s por defecto).
        this._timer = setTimeout(() => {
            this._dismiss();
        }, timeoutMs);
    },

    // Ejecutar el deshacer
    async undo() {
        if (!this._pending || this._pending.undoing) return false;

        const pending = this._pending;
        const { restoreFn, label, options = {} } = pending;
        clearTimeout(this._timer);
        pending.undoing = true;
        try {
            await Promise.resolve(restoreFn());
            if (this._dependencies.saveFn) {
                await Promise.resolve(this._dependencies.saveFn(options.saveOptions));
            }
            this._dismiss();
            if (this._dependencies.renderFn) this._dependencies.renderFn();
            if (this._dependencies.showNotificationFn) {
                this._dependencies.showNotificationFn(`↩️ Deshecho: ${label}`, 'info');
            }
            return true;
        } catch (error) {
            pending.undoing = false;
            throw error;
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
                <button class="undo-toast-btn" type="button">DESHACER</button>
                <button class="undo-toast-close" type="button" aria-label="Descartar">${icons.get('close')}</button>
            </div>
        `;

        // Listeners directos (no inline onclick)
        const undoBtn = el.querySelector('.undo-toast-btn');
        const closeBtn = el.querySelector('.undo-toast-close');
        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
        if (closeBtn) closeBtn.addEventListener('click', () => this._dismiss());

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
