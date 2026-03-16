import { icons } from '../ui/IconSystem.js';
export class Modal {
    constructor(options = {}) {
        this.title = options.title || '';
        this.content = options.content || '';
        this.size = options.size || 'medium'; // 'small', 'medium', 'large', 'fullscreen'
        this.closable = options.closable !== undefined ? options.closable : true;
        this.buttons = options.buttons || null;
        this.onClose = options.onClose || null;
        this.onOpen = options.onOpen || null;
        this.backdrop = options.backdrop !== undefined ? options.backdrop : true;
        this.element = null;
        this.isOpen = false;
    }

    // Crear el HTML del modal
    render() {
        const sizeClasses = {
            small: 'modal-small',
            medium: 'modal-medium',
            large: 'modal-large',
            fullscreen: 'modal-fullscreen'
        };

        const modalHTML = `
                    <div class="modal-overlay ${this.backdrop ? 'modal-backdrop' : ''}" data-modal-overlay>
                        <div class="modal-container ${sizeClasses[this.size]} modal-enter" data-modal-container>
                            <div class="modal-header">
                                <h2 class="modal-title">${this.title}</h2>
                                ${this.closable ? `<button class="modal-close" data-modal-close aria-label="Cerrar">${icons.get('close')}</button>` : ''}
                            </div>
                            <div class="modal-body">
                                ${this.content}
                            </div>
                            ${this.buttons ? this.renderButtons() : ''}
                        </div>
                    </div>
                `;

        const div = document.createElement('div');
        div.innerHTML = modalHTML;
        this.element = div.firstElementChild;

        // Event listeners
        this.attachEventListeners();

        return this.element;
    }

    // Renderizar botones personalizados
    renderButtons() {
        const buttonsHTML = this.buttons.map((btn, index) => {
            const btnClass = btn.class || 'btn-secondary';
            const btnStyle = btn.style ? `style="${btn.style}"` : '';
            return `<button class="modal-btn ${btnClass}" data-button-index="${index}" ${btnStyle}>${btn.text}</button>`;
        }).join('');

        return `<div class="modal-footer">${buttonsHTML}</div>`;
    }

    // Adjuntar event listeners
    attachEventListeners() {
        // Cerrar al hacer click en X
        if (this.closable) {
            const closeBtn = this.element.querySelector('[data-modal-close]');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.close());
            }
        }

        // Cerrar al hacer click en overlay
        if (this.backdrop) {
            this.element.addEventListener('click', (e) => {
                if (e.target.hasAttribute('data-modal-overlay')) {
                    this.close();
                }
            });
        }

        // Botones personalizados
        if (this.buttons) {
            const buttonElements = this.element.querySelectorAll('[data-button-index]');
            buttonElements.forEach((btn, index) => {
                btn.addEventListener('click', () => {
                    const button = this.buttons[index];
                    if (button.onClick) {
                        button.onClick.call(this);
                    }
                });
            });
        }

        // Cerrar con ESC
        this.escHandler = (e) => {
            if (e.key === 'Escape' && this.closable) {
                this.close();
            }
        };
        document.addEventListener('keydown', this.escHandler);
    }

    // Abrir modal
    open() {
        if (this.isOpen) return this;

        document.body.appendChild(this.render());
        document.body.style.overflow = 'hidden';

        // Trigger animation
        setTimeout(() => {
            const container = this.element.querySelector('[data-modal-container]');
            container.classList.remove('modal-enter');
            container.classList.add('modal-visible');
        }, 10);

        this.isOpen = true;

        if (this.onOpen) {
            this.onOpen.call(this);
        }

        return this;
    }

    // Cerrar modal
    close() {
        if (!this.isOpen) return this;

        const container = this.element.querySelector('[data-modal-container]');
        container.classList.remove('modal-visible');
        container.classList.add('modal-exit');

        setTimeout(() => {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            document.body.style.overflow = '';
            document.removeEventListener('keydown', this.escHandler);
        }, 300);

        this.isOpen = false;

        if (this.onClose) {
            this.onClose.call(this);
        }

        return this;
    }

    // Actualizar contenido
    updateContent(newContent) {
        if (this.element) {
            const body = this.element.querySelector('.modal-body');
            if (body) {
                body.innerHTML = newContent;
            }
        }
        this.content = newContent;
        return this;
    }

    // Modal de confirmación
    static confirm(options = {}) {
        return new Modal({
            title: options.title || '¿Confirmar?',
            content: `<p style="color: #94a3b8; line-height: 1.6;">${options.message || '¿Estás seguro?'}</p>`,
            size: 'small',
            buttons: [
                {
                    text: options.cancelText || 'Cancelar',
                    class: 'btn-secondary',
                    onClick: function () {
                        this.close();
                        if (options.onCancel) options.onCancel();
                    }
                },
                {
                    text: options.confirmText || 'Confirmar',
                    class: options.type === 'danger' ? 'btn-danger' : 'btn-primary',
                    onClick: function () {
                        this.close();
                        if (options.onConfirm) options.onConfirm();
                    }
                }
            ]
        }).open();
    }

    // Modal de alerta
    static alert(options = {}) {
        return new Modal({
            title: options.title || 'Información',
            content: `<p style="color: #94a3b8; line-height: 1.6;">${options.message || ''}</p>`,
            size: 'small',
            buttons: [
                {
                    text: options.buttonText || 'OK',
                    class: 'btn-primary',
                    onClick: function () {
                        this.close();
                        if (options.onClose) options.onClose();
                    }
                }
            ]
        }).open();
    }
}
