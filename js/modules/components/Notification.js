import icons from '../ui/IconSystem.js';

export const NOTIFICATION_SVGS = {
    // Tipos de notificación
    'check': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    'success': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    'x-circle': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    'error': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    'alert': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'warning': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'info': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    'close': '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',

    // Acciones comunes
    'sync': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>',
    'refresh': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    'cloud': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    'download': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    'upload': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
};

export function getNotificationActionSvg(iconKey) {
    if (!iconKey) return '';
    if (NOTIFICATION_SVGS[iconKey]) return NOTIFICATION_SVGS[iconKey];
    const res = icons.get(iconKey);
    if (res && res.includes('<svg')) return res;
    return NOTIFICATION_SVGS.check;
}

export function sanitizeNotificationMessage(msg) {
    if (typeof msg !== 'string') return msg;
    return msg
        .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{200D}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{2705}\u{274C}\u{26A0}\u{2139}\u{2714}\u{2716}\u{1F4E5}\u{1F4E4}\u{1F5D1}\u{1F4F8}\u{1F680}\u{21A9}\u{1F504}\u{1F4A1}\u{1F6A8}\u{1F4CB}\u{1F4C5}\u{1F4C4}\u{1F514}\u{1F4B0}]+/u, '')
        .trim();
}

export class Notification {
    static activeNotifications = [];
    static MAX_STACK = 3;
    // Tope absoluto para errores: aunque sean sticky se cierran después de este tiempo
    // (evita acumulación en pantalla si el usuario no las descarta)
    static ERROR_MAX_DURATION = 15000;

    constructor(options = {}) {
        this.message = sanitizeNotificationMessage(options.message || '');
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
        return NOTIFICATION_SVGS[type] || NOTIFICATION_SVGS.info;
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
                <span class="notification-message"></span>
            </div>
            <div class="notification-actions">
                ${this.actions.map((a, i) => `<button class="notification-action" data-action-index="${i}">${a.icon ? `<span class="notification-action-icon">${getNotificationActionSvg(a.icon)}</span>` : ''}<span class="notification-action-label"></span></button>`).join('')}
                ${this.closable ? `<button class="notification-close" aria-label="Cerrar">${NOTIFICATION_SVGS.close}</button>` : ''}
            </div>
        `;

        if (this.variant === 'update') {
            this._hydrateUpdateInfo();
            this._attachUpdateDisclosureListener();
        } else {
            const messageEl = this.element.querySelector('.notification-message');
            if (messageEl) messageEl.textContent = this.message;
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
                        <img class="notification-update__app-icon" src="./icon.svg" alt="">
                    </span>
                    <span class="notification-content">
                        <span class="notification-message"></span>
                        <small>Toca para ver la actualización</small>
                    </span>
                    <span class="notification-update__expand-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 5v14"></path>
                            <path d="m19 12-7 7-7-7"></path>
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
                        ${this.actions.map((a, i) => `
                            <button class="notification-action" data-action-index="${i}">
                                <span class="notification-action-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24">
                                        <path d="M20 11a8 8 0 0 0-14.9-4"></path>
                                        <path d="M5 3v4h4"></path>
                                        <path d="M4 13a8 8 0 0 0 14.9 4"></path>
                                        <path d="M19 21v-4h-4"></path>
                                    </svg>
                                </span>
                                <span class="notification-action-label"></span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </details>
            ${this.closable ? `<button class="notification-close" aria-label="Cerrar"><span class="notification-close__icon">${icons.get('close')}</span></button>` : ''}
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
        if (options.message !== undefined) this.message = sanitizeNotificationMessage(options.message);
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
            const actionBtns = this.actions.map((a, i) => `<button class="notification-action" data-action-index="${i}">${a.icon ? `<span class="notification-action-icon">${getNotificationActionSvg(a.icon)}</span>` : ''}<span class="notification-action-label"></span></button>`).join('');
            const closeBtn = this.closable ? `<button class="notification-close" aria-label="Cerrar">${NOTIFICATION_SVGS.close}</button>` : '';
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
