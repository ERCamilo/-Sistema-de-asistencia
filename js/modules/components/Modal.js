import icons from '../ui/IconSystem.js';
export class Modal {
    constructor(options = {}) {
        this.title = options.title || '';
        this.subtitle = options.subtitle || null;
        this.content = options.content || '';
        this.size = options.size || 'medium'; // 'small', 'medium', 'large', 'fullscreen'
        this.variant = options.variant || 'modal'; // 'modal', 'drawer'
        this.position = options.position || 'center'; // 'center', 'right', 'left'
        this.closable = options.closable !== undefined ? options.closable : true;
        this.buttons = options.buttons || null;
        if (options.onClose) this.onClose = options.onClose;
        if (options.onOpen) this.onOpen = options.onOpen;
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

        const variantClass = this.variant === 'drawer' ? `modal-drawer modal-drawer-${this.position}` : '';
        const animationClass = this.variant === 'drawer' ? 'drawer-enter' : 'modal-enter';

        const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;
        this._titleId = titleId;
        const modalHTML = `
                    <div class="modal-overlay ${this.backdrop ? 'modal-backdrop' : ''} ${this.variant === 'drawer' ? 'drawer-overlay' : ''}" data-modal-overlay role="presentation">
                        <div class="modal-container ${sizeClasses[this.size]} ${variantClass} ${animationClass}" data-modal-container role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
                            <div class="modal-header" style="${this.subtitle ? 'flex-direction: column; align-items: flex-start; gap: 4px;' : ''}">
                                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                    <h2 class="modal-title" id="${titleId}">${this.title}</h2>
                                    ${this.closable ? `<button class="modal-close" data-modal-close aria-label="Cerrar">${icons.get('close')}</button>` : ''}
                                </div>
                                ${this.subtitle ? `<div class="modal-subtitle" style="font-size: 0.85rem; color: #94a3b8; font-weight: 500; margin-top: 2px;">${this.subtitle}</div>` : ''}
                            </div>
                            <div class="modal-body"></div>
                            ${this.buttons ? this.renderButtons() : ''}
                        </div>
                    </div>
                `;

        const div = document.createElement('div');
        div.innerHTML = modalHTML;
        this.element = div.firstElementChild;

        // Inyectar contenido (string o Elemento)
        const body = this.element.querySelector('.modal-body');
        if (typeof this.content === 'string') {
            body.innerHTML = this.content;
        } else if (this.content instanceof HTMLElement) {
            body.appendChild(this.content);
        }

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

        // Cerrar con ESC + Focus trap (Tab/Shift+Tab cycling)
        this.keydownHandler = (e) => {
            if (e.key === 'Escape' && this.closable) {
                this.close();
                return;
            }
            if (e.key === 'Tab') {
                const focusables = this._getFocusableElements();
                if (focusables.length === 0) {
                    e.preventDefault();
                    return;
                }
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                const active = document.activeElement;
                if (e.shiftKey && active === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && active === last) {
                    e.preventDefault();
                    first.focus();
                } else if (!this.element.contains(active)) {
                    // Foco salió del modal — devolverlo
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', this.keydownHandler);
    }

    // Devuelve los elementos enfocables dentro del modal
    _getFocusableElements() {
        if (!this.element) return [];
        const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        return Array.from(this.element.querySelectorAll(selector))
            .filter(el => el.offsetParent !== null || el === document.activeElement);
    }

    // Abrir modal
    open() {
        if (this.isOpen) return this;

        // Guardar el elemento que tenía el foco para restaurarlo al cerrar
        this._previouslyFocused = document.activeElement;

        document.body.appendChild(this.render());
        document.body.style.overflow = 'hidden';

        // Trigger animation
        setTimeout(() => {
            const container = this.element.querySelector('[data-modal-container]');
            if (container) {
                const enterClass = this.variant === 'drawer' ? 'drawer-enter' : 'modal-enter';
                const visibleClass = this.variant === 'drawer' ? 'drawer-visible' : 'modal-visible';
                container.classList.remove(enterClass);
                container.classList.add(visibleClass);

                // Enfocar el primer elemento enfocable (o el contenedor)
                const focusables = this._getFocusableElements();
                if (focusables.length > 0) {
                    focusables[0].focus();
                } else {
                    container.focus();
                }
            }
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
        if (container) {
            const visibleClass = this.variant === 'drawer' ? 'drawer-visible' : 'modal-visible';
            const exitClass = this.variant === 'drawer' ? 'drawer-exit' : 'modal-exit';
            container.classList.remove(visibleClass);
            container.classList.add(exitClass);
        }

        // Quitar listener inmediatamente para evitar leaks si se destruye el modal antes del timeout
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }

        setTimeout(() => {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            document.body.style.overflow = '';

            // Restaurar el foco al elemento que lo tenía antes de abrir
            if (this._previouslyFocused && typeof this._previouslyFocused.focus === 'function') {
                try { this._previouslyFocused.focus(); } catch (_) { /* element no longer in DOM */ }
                this._previouslyFocused = null;
            }
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
                if (typeof newContent === 'string') {
                    body.innerHTML = newContent;
                } else if (newContent instanceof HTMLElement) {
                    body.innerHTML = '';
                    body.appendChild(newContent);
                }
            }
        }
        this.content = newContent;
        return this;
    }

    // Modal de confirmación — retorna Promise<boolean> y también soporta callbacks
    static confirm(options = {}) {
        return new Promise((resolve) => {
            const modal = new Modal({
                title: options.title || '¿Confirmar?',
                content: `<p style="color: #94a3b8; line-height: 1.6;">${options.message || '¿Estás seguro?'}</p>`,
                size: 'small',
                onClose: () => {
                    if (!modal._resolved) {
                        modal._resolved = true;
                        if (options.onCancel) options.onCancel();
                        resolve(false);
                    }
                },
                buttons: [
                    {
                        text: options.cancelText || 'Cancelar',
                        class: 'btn-secondary',
                        onClick: function () {
                            modal._resolved = true;
                            this.close();
                            if (options.onCancel) options.onCancel();
                            resolve(false);
                        }
                    },
                    {
                        text: options.confirmText || 'Confirmar',
                        class: options.type === 'danger' ? 'btn-danger' : 'btn-primary',
                        onClick: function () {
                            modal._resolved = true;
                            this.close();
                            if (options.onConfirm) options.onConfirm();
                            resolve(true);
                        }
                    }
                ]
            });
            modal.open();
        });
    }

    // Modal de alerta — retorna Promise<void>
    static alert(options = {}) {
        return new Promise((resolve) => {
            const modal = new Modal({
                title: options.title || 'Información',
                content: `<p style="color: #94a3b8; line-height: 1.6;">${options.message || ''}</p>`,
                size: 'small',
                onClose: () => {
                    if (!modal._resolved) {
                        modal._resolved = true;
                        if (options.onClose) options.onClose();
                        resolve();
                    }
                },
                buttons: [
                    {
                        text: options.buttonText || 'OK',
                        class: 'btn-primary',
                        onClick: function () {
                            modal._resolved = true;
                            this.close();
                            if (options.onClose) options.onClose();
                            resolve();
                        }
                    }
                ]
            });
            modal.open();
        });
    }

    // Modal de prompt — retorna Promise<string|null>
    static prompt(options = {}) {
        return new Promise((resolve) => {
            const inputId = `modal-prompt-input-${Date.now()}`;
            const escapeAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const content = `
                <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 12px;">${options.message || ''}</p>
                <input id="${inputId}" type="${options.inputType || 'text'}" class="form-input"
                    placeholder="${escapeAttr(options.placeholder || '')}"
                    value="${escapeAttr(options.defaultValue || '')}"
                    style="width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: 0.95rem;"
                    aria-label="${escapeAttr(options.title || options.message || 'Entrada')}">
            `;
            const modal = new Modal({
                title: options.title || 'Ingrese un valor',
                content,
                size: 'small',
                onOpen: function () {
                    const input = this.element.querySelector(`#${inputId}`);
                    if (input) {
                        setTimeout(() => input.focus(), 50);
                        input.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                modal._resolved = true;
                                const val = input.value;
                                this.close();
                                resolve(val);
                            }
                        });
                    }
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
                        text: options.confirmText || 'Aceptar',
                        class: 'btn-primary',
                        onClick: function () {
                            modal._resolved = true;
                            const input = this.element.querySelector(`#${inputId}`);
                            const val = input ? input.value : '';
                            this.close();
                            resolve(val);
                        }
                    }
                ]
            });
            modal.open();
        });
    }
}
