import icons from '../ui/IconSystem.js';

export class Notification {
    static activeNotifications = [];
    static MAX_STACK = 3;
    // Tope absoluto para errores: aunque sean sticky se cierran después de este tiempo
    // (evita acumulación en pantalla si el usuario no las descarta)
    static ERROR_MAX_DURATION = 15000;

    constructor(options = {}) {
        this.message = options.message || '';
        this.type = options.type || 'info'; // 'success', 'error', 'warning', 'info', 'loading'

        // Duration por defecto: loading es sticky (0), error tiene tope de 15s, resto 4s
        let defaultDuration;
        if (this.type === 'loading') {
            defaultDuration = 0;
        } else if (this.type === 'error') {
            defaultDuration = Notification.ERROR_MAX_DURATION;
        } else {
            defaultDuration = 4000;
        }

        this.duration = options.duration !== undefined ? options.duration : defaultDuration;

        // Aunque el caller pida sticky (0) para un error, aplicamos un tope máximo
        // para evitar acumulación. Loading sí puede ser sticky indefinidamente
        // (es controlado por el caller con .close() cuando termina).
        if (this.type === 'error' && this.duration === 0) {
            this.duration = Notification.ERROR_MAX_DURATION;
        }

        this.position = options.position || 'top-center';
        this.variant = options.variant === 'update' ? 'update' : '';
        this.updateInfo = (options.updateInfo && typeof options.updateInfo === 'object')
            ? options.updateInfo
            : {};
        this.closable = options.closable !== undefined ? options.closable : (this.type !== 'loading');
        // Acciones opcionales: [{ label, onClick, closeOnClick }]. closeOnClick
        // por defecto cierra la notificación tras ejecutar onClick.
        this.actions = Array.isArray(options.actions) ? options.actions : [];
        this.element = null;
        this.container = null;
        this.dismissTimeout = null;
    }

    // Crear el contenedor si no existe
    static getContainer(position = 'top-center') {
        const id = `notification-container-${position}`;
        let container = document.getElementById(id);

        if (!container) {
            container = document.createElement('div');
            container.id = id;
            container.className = `notification-container ${position}`;
            document.body.appendChild(container);
        }

        return container;
    }

    // Obtener el icono según el tipo
    _getIcon(type) {
        if (type === 'loading') {
            return '<span class="notification-spinner"></span>';
        }
        const typeIcons = {
            success: icons.get('check'),
            error: icons.get('x-circle'),
            warning: icons.get('alert'),
            info: icons.get('info')
        };
        return typeIcons[type] || typeIcons.info;
    }

    // Mostrar notificacion
    show() {
        this.container = Notification.getContainer(this.position);

        this.element = document.createElement('div');
        const variantClass = this.variant ? ` notification-${this.variant}` : '';
        this.element.className = `notification notification-${this.type}${variantClass} notification-enter`;
        this.element.dataset.type = this.type;

        this.element.innerHTML = this.variant === 'update' ? this._renderUpdateMarkup() : `
            <div class="notification-icon-wrapper">
                <span class="notification-icon">${this._getIcon(this.type)}</span>
            </div>
            <div class="notification-content">
                <span class="notification-message">${this.message}</span>
            </div>
            <div class="notification-actions">
                ${this.actions.map((a, i) => `<button class="notification-action" data-action-index="${i}">${a.icon ? `<span class="notification-action-icon">${icons.get(a.icon)}</span>` : ''}<span class="notification-action-label"></span></button>`).join('')}
                ${this.closable ? `<button class="notification-close" aria-label="Cerrar">${icons.get('close')}</button>` : ''}
            </div>
        `;

        if (this.variant === 'update') {
            this._hydrateUpdateInfo();
            this._attachUpdateDisclosureListener();
        }

        // Event listeners (acciones primero, luego cerrar)
        this._attachActionListeners();
        if (this.closable) {
            this._attachCloseListener();
        }

        // Agregar al inicio del array (la más nueva)
        Notification.activeNotifications.unshift(this);
        this.container.appendChild(this.element);

        // Actualizar posiciones de todas
        Notification.updatePositions(this.position);

        // Trigger animation
        setTimeout(() => {
            if (this.element) {
                this.element.classList.remove('notification-enter');
                this.element.classList.add('notification-visible');
            }
        }, 10);

        // Auto-dismiss
        this._startDismissTimer();

        return this;
    }

    _renderUpdateMarkup() {
        return `
            <details class="notification-update__disclosure">
                <summary class="notification-update__summary">
                    <span class="notification-icon-wrapper">
                        <span class="notification-icon">${this._getIcon(this.type)}</span>
                    </span>
                    <span class="notification-content">
                        <span class="notification-message"></span>
                        <small>Toca para ver la actualización</small>
                    </span>
                    <span class="notification-update__expand-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 19V5"></path>
                            <path d="m5 12 7-7 7 7"></path>
                        </svg>
                    </span>
                </summary>
                <div class="notification-update__panel">
                    <div class="notification-update__heading">
                        <strong>Actualización lista</strong>
                        <span>La nueva compilación ya se descargó y puede instalarse.</span>
                    </div>
                    <details class="notification-update__metadata">
                        <summary>Datos de la actualización</summary>
                        <dl>
                            <div><dt>Versión de la app</dt><dd data-update-info="app-version"></dd></div>
                            <div><dt>Instalada</dt><dd data-update-info="current-build"></dd></div>
                            <div><dt>Disponible</dt><dd data-update-info="available-build"></dd></div>
                        </dl>
                    </details>
                    <div class="notification-actions">
                        ${this.actions.map((a, i) => `<button class="notification-action" data-action-index="${i}">${a.icon ? `<span class="notification-action-icon">${icons.get(a.icon)}</span>` : ''}<span class="notification-action-label"></span></button>`).join('')}
                    </div>
                </div>
            </details>
            ${this.closable ? `<button class="notification-close" aria-label="Cerrar">${icons.get('close')}</button>` : ''}
        `;
    }

    _hydrateUpdateInfo() {
        if (!this.element) return;
        const text = (selector, value, fallback = 'No disponible') => {
            const target = this.element.querySelector(selector);
            if (target) target.textContent = value || fallback;
        };
        text('.notification-message', this.message, 'Nueva versión disponible');
        text('[data-update-info="app-version"]', this.updateInfo.appVersion);
        text('[data-update-info="current-build"]', this.updateInfo.currentBuild);
        text('[data-update-info="available-build"]', this.updateInfo.availableBuild);
    }

    _attachUpdateDisclosureListener() {
        const disclosure = this.element?.querySelector('.notification-update__disclosure');
        if (!disclosure) return;
        disclosure.addEventListener('toggle', () => {
            this.element?.classList.toggle('is-expanded', disclosure.open);
            Notification.updatePositions(this.position);
        });
    }

    // Actualizar una notificación existente
    update(options = {}) {
        if (!this.element) return this;

        // Limpiar timer anterior
        this._stopDismissTimer();

        // Actualizar propiedades
        if (options.type) this.type = options.type;
        if (options.message) this.message = options.message;
        if (options.duration !== undefined) this.duration = options.duration;
        if (options.closable !== undefined) this.closable = options.closable;
        // U11: asignar this.actions desde options.actions. El bloque de abajo
        // (actionsEl) YA re-renderizaba this.actions — pero nunca se asignaba
        // fuera del constructor, así que un update() jamás podía AGREGAR (ni
        // quitar) botones a un toast ya existente. Array.isArray cubre tanto
        // "agregar" (array no vacío) como "vaciar explícitamente" ([]); si
        // options.actions viene undefined, no se toca (preserva las previas).
        if (Array.isArray(options.actions)) this.actions = options.actions;

        // Actualizar visualmente
        this.element.classList.add('notification-updating');
        this.element.dataset.type = this.type;
        
        // Cambiar clases de tipo
        const typeClasses = ['success', 'error', 'warning', 'info', 'loading'].map(t => `notification-${t}`);
        this.element.classList.remove(...typeClasses);
        this.element.classList.add(`notification-${this.type}`);

        // Actualizar contenido
        const iconEl = this.element.querySelector('.notification-icon');
        const messageEl = this.element.querySelector('.notification-message');
        const actionsEl = this.element.querySelector('.notification-actions');

        if (iconEl) iconEl.innerHTML = this._getIcon(this.type);
        if (messageEl) messageEl.textContent = this.message;
        
        if (actionsEl) {
            const actionBtns = this.actions.map((a, i) => `<button class="notification-action" data-action-index="${i}">${a.icon ? `<span class="notification-action-icon">${icons.get(a.icon)}</span>` : ''}<span class="notification-action-label"></span></button>`).join('');
            const closeBtn = this.closable ? `<button class="notification-close" aria-label="Cerrar">${icons.get('close')}</button>` : '';
            actionsEl.innerHTML = actionBtns + closeBtn;
            this._attachActionListeners();
            if (this.closable) this._attachCloseListener();
        }

        setTimeout(() => {
            if (this.element) this.element.classList.remove('notification-updating');
        }, 300);

        // Reiniciar timer si procede
        // Si el nuevo tipo es success y no se especificó duración, poner 4s
        if (this.type === 'success' && options.duration === undefined) {
            this.duration = 4000;
        }
        
        this._startDismissTimer();
        
        return this;
    }

    _attachCloseListener() {
        const closeBtn = this.element.querySelector('.notification-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.dismiss();
            });
        }
    }

    // Cablea los botones de acción. Las etiquetas se asignan con textContent
    // (no innerHTML) para que no puedan inyectar markup. Por defecto la acción
    // cierra la notificación tras ejecutar onClick (closeOnClick !== false).
    _attachActionListeners() {
        if (!this.element || !this.actions.length) return;
        this.actions.forEach((action, i) => {
            const btn = this.element.querySelector(`.notification-action[data-action-index="${i}"]`);
            if (!btn) return;
            // La etiqueta va con textContent (sin HTML); el ícono ya se renderizó
            // en el markup vía icons.get (controlado por la app, igual que cerrar).
            const labelEl = btn.querySelector('.notification-action-label');
            if (labelEl) labelEl.textContent = action.label || 'OK';
            else btn.textContent = action.label || 'OK';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    if (typeof action.onClick === 'function') action.onClick();
                } finally {
                    if (action.closeOnClick !== false) this.dismiss();
                }
            });
        });
    }

    _startDismissTimer() {
        if (this.duration > 0) {
            this.dismissTimeout = setTimeout(() => this.dismiss(), this.duration);
        }
    }

    _stopDismissTimer() {
        if (this.dismissTimeout) {
            clearTimeout(this.dismissTimeout);
            this.dismissTimeout = null;
        }
    }

    // Cerrar notificacion
    dismiss() {
        if (!this.element) return;

        // Remover de la lista activa
        const index = Notification.activeNotifications.indexOf(this);
        if (index > -1) {
            Notification.activeNotifications.splice(index, 1);
        }

        this.element.classList.remove('notification-visible');
        this.element.classList.add('notification-exit');

        // Actualizar las que quedan
        Notification.updatePositions(this.position);

        setTimeout(() => {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
                this.element = null;
            }
        }, 400);
    }

    // Actualizar visualmente el stack de notificaciones
    static updatePositions(position) {
        const notificationsInPos = Notification.activeNotifications.filter(n => n.position === position);
        
        notificationsInPos.forEach((notification, index) => {
            const el = notification.element;
            if (!el) return;

            // Lógica de Sileo: las más viejas se hunden y se achican
            const isBottom = position.startsWith('bottom');
            const multiplier = isBottom ? -1 : 1;
            
            // Solo mostramos hasta MAX_STACK de forma destacada
            if (index < Notification.MAX_STACK) {
                const yOffset = index * 12 * multiplier;
                const scale = 1 - (index * 0.05);
                const opacity = 1 - (index * 0.2);
                const zIndex = 10000 - index;

                el.style.transform = `translateY(${yOffset}px) scale(${scale})`;
                el.style.opacity = opacity;
                el.style.zIndex = zIndex;
                el.style.pointerEvents = index === 0 ? 'all' : 'none'; // Solo la de arriba es interactiva fácilmente
            } else {
                // Ocultar las que exceden el stack
                el.style.transform = `translateY(${multiplier * 40}px) scale(0.8)`;
                el.style.opacity = '0';
                el.style.pointerEvents = 'none';
                // Descartar las muy desplazadas para que no se acumulen en el DOM
                // (mantiene MAX_STACK visibles + 2 de buffer)
                if (index >= Notification.MAX_STACK + 2) {
                    setTimeout(() => notification.dismiss(), 100);
                }
            }
        });
    }

    // Metodos estaticos de conveniencia
    static success(message, optionsOrDuration) {
        const options = typeof optionsOrDuration === 'object' ? optionsOrDuration : { duration: optionsOrDuration };
        return new Notification({ ...options, message, type: 'success' }).show();
    }

    static error(message, optionsOrDuration) {
        const options = typeof optionsOrDuration === 'object' ? optionsOrDuration : { duration: optionsOrDuration };
        return new Notification({ ...options, message, type: 'error' }).show();
    }

    static warning(message, optionsOrDuration) {
        const options = typeof optionsOrDuration === 'object' ? optionsOrDuration : { duration: optionsOrDuration };
        return new Notification({ ...options, message, type: 'warning' }).show();
    }

    static info(message, optionsOrDuration) {
        const options = typeof optionsOrDuration === 'object' ? optionsOrDuration : { duration: optionsOrDuration };
        return new Notification({ ...options, message, type: 'info' }).show();
    }

    static loading(message) {
        return new Notification({ message, type: 'loading', duration: 0, closable: false }).show();
    }

    static clearAll() {
        [...Notification.activeNotifications].forEach(n => n.dismiss());
    }
}

// 📢 Alias para compatibilidad con el sistema legacy (NotificationSystem)
export const NotificationSystem = {
    success: (msg, dur) => Notification.success(msg, dur),
    error: (msg, dur) => Notification.error(msg, dur),
    warning: (msg, dur) => Notification.warning(msg, dur),
    info: (msg, dur) => Notification.info(msg, dur),
    clear: () => Notification.clearAll(),
    loading: (msg) => Notification.loading(msg)
};

// 🌍 Alpha Refactorizer: Exponer a globalThis para disponibilidad inmediata
if (typeof window !== 'undefined') {
    window.Notification = Notification;
}
