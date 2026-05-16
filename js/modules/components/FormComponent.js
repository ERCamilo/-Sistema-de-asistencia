import { ComponentBase } from './ComponentBase.js';

export class FormComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: {
        //   fields: [{ name, label, type, required?, options?, placeholder? }],
        //   onSubmit: function,
        //   submitText?,
        //   cancelText?,
        //   onCancel?,
        //   values?
        // }
    }

    renderField(field) {
        const { values = {} } = this.props;
        const value = values[field.name];
        const required = field.required ? 'required' : '';
        const errId = `${field.name}-error`;
        const ariaInvalid = 'aria-invalid="false"';
        const ariaDescribedBy = `aria-describedby="${errId}"`;
        // inputmode automático para tipo number
        const inputMode = field.inputMode || (field.type === 'number' ? 'decimal' : '');
        const inputModeAttr = inputMode ? `inputmode="${inputMode}"` : '';
        const autocompleteAttr = field.autocomplete ? `autocomplete="${field.autocomplete}"` : '';

        switch (field.type) {
            case 'text':
            case 'email':
            case 'tel':
            case 'number':
            case 'password':
            case 'date':
                return `
                    <div class="form-group" data-field="${field.name}">
                        <label for="${field.name}">
                            ${field.label}
                            ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <input
                            type="${field.type}"
                            id="${field.name}"
                            name="${field.name}"
                            value="${value || ''}"
                            placeholder="${field.placeholder || ''}"
                            ${required}
                            ${inputModeAttr}
                            ${autocompleteAttr}
                            ${ariaInvalid}
                            ${ariaDescribedBy}
                            class="form-input">
                        ${field.helpText ? `<small class="form-help">${field.helpText}</small>` : ''}
                        <small class="form-error" id="${errId}" role="alert" style="display:none; color:#ef4444; font-size:0.8rem; margin-top:4px;"></small>
                    </div>
                `;

            case 'textarea':
                return `
                    <div class="form-group" data-field="${field.name}">
                        <label for="${field.name}">
                            ${field.label}
                            ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <textarea
                            id="${field.name}"
                            name="${field.name}"
                            placeholder="${field.placeholder || ''}"
                            ${required}
                            ${ariaInvalid}
                            ${ariaDescribedBy}
                            class="form-input"
                            rows="${field.rows || 3}">${value || ''}</textarea>
                        <small class="form-error" id="${errId}" role="alert" style="display:none; color:#ef4444; font-size:0.8rem; margin-top:4px;"></small>
                    </div>
                `;

            case 'select':
                const options = (field.options || []).map(opt => {
                    const selected = String(opt.value) === String(value) ? 'selected' : '';
                    return `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
                }).join('');

                return `
                    <div class="form-group">
                        <label for="${field.name}">
                            ${field.label}
                            ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <select 
                            id="${field.name}" 
                            name="${field.name}" 
                            ${required}
                            class="form-input">
                            <option value="">${field.placeholder || 'Seleccionar...'}</option>
                            ${options}
                        </select>
                    </div>
                `;

            case 'checkbox-group':
                const checkboxes = (field.options || []).map(opt => {
                    const isChecked = Array.isArray(value) && value.includes(opt.value) ? 'checked' : '';
                    return `
                        <label class="checkbox-item">
                            <input type="checkbox" name="${field.name}" value="${opt.value}" ${isChecked}>
                            <span>${opt.label}</span>
                        </label>
                    `;
                }).join('');

                return `
                    <div class="form-group">
                        <label>${field.label} ${field.required ? '<span class="required">*</span>' : ''}</label>
                        <div class="checkbox-group">
                            ${checkboxes}
                        </div>
                    </div>
                `;

            case 'radio-group':
                const radios = (field.options || []).map(opt => {
                    const isChecked = String(opt.value) === String(value) ? 'checked' : '';
                    return `
                        <label class="radio-item">
                            <input type="radio" name="${field.name}" value="${opt.value}" ${isChecked}>
                            <span>${opt.label}</span>
                        </label>
                    `;
                }).join('');

                return `
                    <div class="form-group">
                        <label>${field.label} ${field.required ? '<span class="required">*</span>' : ''}</label>
                        <div class="radio-group">
                            ${radios}
                        </div>
                    </div>
                `;

            case 'checkbox':
                const checked = value ? 'checked' : '';
                return `
                    <div class="form-group form-group-checkbox">
                        <label>
                            <input 
                                type="checkbox" 
                                id="${field.name}" 
                                name="${field.name}" 
                                ${checked}
                                class="form-checkbox">
                            <span>${field.label}</span>
                        </label>
                    </div>
                `;

            default:
                return '';
        }
    }

    render() {
        const { fields, submitText, cancelText, onCancel } = this.props;

        const fieldsHTML = fields.map(field => this.renderField(field)).join('');

        const html = `
            <form class="form-component">
                <div class="form-body">
                    ${fieldsHTML}
                </div>
                
                <div class="form-actions">
                    ${onCancel ? `
                        <button type="button" class="btn btn-secondary" data-action="cancel">
                            ${cancelText || 'Cancelar'}
                        </button>
                    ` : ''}
                    <button type="submit" class="btn btn-primary">
                        ${submitText || 'Guardar'}
                    </button>
                </div>
            </form>
        `;

        this.element = this.createElement(html);
        this.attachEventListeners();

        return this.element;
    }

    attachEventListeners() {
        const form = this.element;
        const { onSubmit, onCancel, fields, submitText } = this.props;
        let isSubmitting = false;

        // Autofocus en el primer campo de texto/select/textarea
        const firstInput = form.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea');
        if (firstInput) {
            setTimeout(() => { try { firstInput.focus(); } catch (_) {} }, 50);
        }

        // Validación inline: limpiar error al modificar el campo
        fields.forEach(field => {
            const input = form.querySelector(`[name="${field.name}"]`);
            if (input && (input.type !== 'checkbox' && input.type !== 'radio')) {
                const clearOnChange = () => this._clearFieldError(field.name);
                input.addEventListener('input', clearOnChange);
                input.addEventListener('blur', () => this._validateField(field));
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (isSubmitting) return; // Anti-doble-submit

            const formData = new FormData(form);
            const data = {};

            fields.forEach(field => {
                if (field.type === 'checkbox-group') {
                    data[field.name] = formData.getAll(field.name);
                } else if (field.type === 'checkbox') {
                    data[field.name] = formData.get(field.name) === 'on';
                } else {
                    data[field.name] = formData.get(field.name);
                }
            });

            // Validar todos los campos antes de enviar
            const errors = this._validateAll(data);
            if (errors.length > 0) {
                // Enfocar el primer campo con error
                const firstErrField = form.querySelector(`[name="${errors[0]}"]`);
                if (firstErrField) firstErrField.focus();
                return;
            }

            if (!onSubmit) return;

            // Bloquear el botón submit y mostrar estado de carga
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn ? submitBtn.innerHTML : '';
            isSubmitting = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.setAttribute('aria-busy', 'true');
                submitBtn.innerHTML = 'Guardando...';
            }

            try {
                await onSubmit(data);
            } catch (err) {
                console.error('Error en submit del formulario:', err);
            } finally {
                isSubmitting = false;
                if (submitBtn && submitBtn.isConnected) {
                    submitBtn.disabled = false;
                    submitBtn.removeAttribute('aria-busy');
                    submitBtn.innerHTML = originalText || (submitText || 'Guardar');
                }
            }
        });

        if (onCancel) {
            const cancelBtn = form.querySelector('[data-action="cancel"]');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => onCancel());
            }
        }
    }

    _validateField(field) {
        const form = this.element;
        const input = form.querySelector(`[name="${field.name}"]`);
        if (!input) return null;
        const value = input.value;

        // Validación de required
        if (field.required && (!value || String(value).trim() === '')) {
            this._showFieldError(field.name, `${field.label} es obligatorio`);
            return 'required';
        }
        // Validación numérica nativa (min/max)
        if (field.type === 'number' && value !== '' && value != null) {
            const num = parseFloat(value);
            if (isNaN(num)) {
                this._showFieldError(field.name, 'Debe ser un número válido');
                return 'invalid-number';
            }
            if (field.min != null && num < field.min) {
                this._showFieldError(field.name, `El valor mínimo es ${field.min}`);
                return 'min';
            }
            if (field.max != null && num > field.max) {
                this._showFieldError(field.name, `El valor máximo es ${field.max}`);
                return 'max';
            }
        }
        // Validador custom del field
        if (typeof field.validate === 'function') {
            const err = field.validate(value);
            if (err) {
                this._showFieldError(field.name, err);
                return 'custom';
            }
        }
        this._clearFieldError(field.name);
        return null;
    }

    _validateAll(data) {
        const errorFields = [];
        this.props.fields.forEach(field => {
            const err = this._validateField(field);
            if (err) errorFields.push(field.name);
        });
        return errorFields;
    }

    _showFieldError(fieldName, message) {
        const form = this.element;
        const group = form.querySelector(`[data-field="${fieldName}"]`);
        if (!group) return;
        const input = group.querySelector('input, textarea, select');
        const errEl = group.querySelector('.form-error');
        if (input) input.setAttribute('aria-invalid', 'true');
        if (errEl) {
            errEl.textContent = message;
            errEl.style.display = 'block';
        }
    }

    _clearFieldError(fieldName) {
        const form = this.element;
        const group = form.querySelector(`[data-field="${fieldName}"]`);
        if (!group) return;
        const input = group.querySelector('input, textarea, select');
        const errEl = group.querySelector('.form-error');
        if (input) input.setAttribute('aria-invalid', 'false');
        if (errEl) {
            errEl.textContent = '';
            errEl.style.display = 'none';
        }
    }
}
