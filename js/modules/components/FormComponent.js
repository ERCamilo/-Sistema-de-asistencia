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

        switch (field.type) {
            case 'text':
            case 'email':
            case 'tel':
            case 'number':
            case 'password':
            case 'date':
                return `
                    <div class="form-group">
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
                            class="form-input">
                        ${field.helpText ? `<small class="form-help">${field.helpText}</small>` : ''}
                    </div>
                `;

            case 'textarea':
                return `
                    <div class="form-group">
                        <label for="${field.name}">
                            ${field.label}
                            ${field.required ? '<span class="required">*</span>' : ''}
                        </label>
                        <textarea 
                            id="${field.name}" 
                            name="${field.name}" 
                            placeholder="${field.placeholder || ''}"
                            ${required}
                            class="form-input"
                            rows="${field.rows || 3}">${value || ''}</textarea>
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
        const { onSubmit, onCancel } = this.props;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const data = {};

            // Procesar campos básicos y grupos de checkboxes
            this.props.fields.forEach(field => {
                if (field.type === 'checkbox-group') {
                    data[field.name] = formData.getAll(field.name);
                } else if (field.type === 'checkbox') {
                    data[field.name] = formData.get(field.name) === 'on';
                } else {
                    data[field.name] = formData.get(field.name);
                }
            });

            if (onSubmit) {
                onSubmit(data);
            }
        });

        if (onCancel) {
            const cancelBtn = form.querySelector('[data-action="cancel"]');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => onCancel());
            }
        }
    }
}
