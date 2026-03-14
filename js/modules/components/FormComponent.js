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
        const value = values[field.name] || '';
        const required = field.required ? 'required' : '';

        switch (field.type) {
            case 'text':
            case 'email':
            case 'tel':
            case 'number':
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
                                    value="${value}"
                                    placeholder="${field.placeholder || ''}"
                                    ${required}
                                    class="form-input">
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
                                    class="form-input">${value}</textarea>
                            </div>
                        `;

            case 'select':
                const options = (field.options || []).map(opt => {
                    const selected = opt.value === value ? 'selected' : '';
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
                                    <option value="">Seleccionar...</option>
                                    ${options}
                                </select>
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
        const { fields, onSubmit, submitText, cancelText, onCancel } = this.props;

        const fieldsHTML = fields.map(field => this.renderField(field)).join('');

        return `
                    <form class="form-component" onsubmit="${onSubmit}(event); return false;">
                        ${fieldsHTML}
                        
                        <div class="form-actions">
                            ${onCancel ? `
                                <button type="button" class="btn btn-secondary" onclick="${onCancel}()">
                                    ${cancelText || 'Cancelar'}
                                </button>
                            ` : ''}
                            <button type="submit" class="btn btn-primary">
                                ${submitText || 'Guardar'}
                            </button>
                        </div>
                    </form>
                `;
    }
}
