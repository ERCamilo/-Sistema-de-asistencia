import { icons } from '../ui/IconSystem.js';

export class Notification {
    constructor(options = {}) {
        this.message = options.message || '';
        this.type = options.type || 'info'; // 'success', 'error', 'warning', 'info'
        this.duration = options.duration !== undefined ? options.duration : 3000;
        this.position = options.position || 'top-right';
        this.closable = options.closable !== undefined ? options.closable : true;
        this.element = null;
        this.container = null;
    }

    // Crear el contenedor si no existe
    static getContainer(position = 'top-right') {
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

    // Mostrar notificacion
    show() {
        this.container = Notification.getContainer(this.position);

        const typeIcons = {
            success: icons.get('check'),
            error: icons.get('x-circle'),
            warning: icons.get('alert'),
            info: icons.get('info')
        };

        this.element = document.createElement('div');
        this.element.className = `notification notification-${this.type} notification-enter`;

        this.element.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">${typeIcons[this.type]}</span>
                <span class="notification-message">${this.message}</span>
            </div>
            ${this.closable ? `<button class="notification-close" aria-label="Cerrar">${icons.get('close')}</button>` : ''}
        `;

        // Event listener para cerrar
        if (this.closable) {
            this.element.querySelector('.notification-close').addEventListener('click', () => {
                this.dismiss();
            });
        }

        this.container.appendChild(this.element);

        // Trigger animation
        setTimeout(() => {
            this.element.classList.remove('notification-enter');
            this.element.classList.add('notification-visible');
        }, 10);

        // Auto-dismiss
        if (this.duration > 0) {
            setTimeout(() => this.dismiss(), this.duration);
        }

        return this;
    }

    // Cerrar notificacion
    dismiss() {
        if (!this.element) return;

        this.element.classList.remove('notification-visible');
        this.element.classList.add('notification-exit');

        setTimeout(() => {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }, 300);
    }

    // Metodos estaticos de conveniencia
    static success(message, duration) {
        return new Notification({ message, type: 'success', duration }).show();
    }

    static error(message, duration = 5000) {
        return new Notification({ message, type: 'error', duration }).show();
    }

    static warning(message, duration = 4000) {
        return new Notification({ message, type: 'warning', duration }).show();
    }

    static info(message, duration) {
        return new Notification({ message, type: 'info', duration }).show();
    }

    // Limpiar todas las notificaciones
    static clearAll() {
        const containers = document.querySelectorAll('[id^="notification-container-"]');
        containers.forEach(container => {
            container.innerHTML = '';
        });
    }
}
