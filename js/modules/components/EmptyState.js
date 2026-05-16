import icons from '../ui/IconSystem.js';

/**
 * Componente EmptyState — estado vacío reutilizable y consistente.
 *
 * Uso (string):
 *   EmptyState.render({ icon: 'inbox', title: 'No hay empleados', description: 'Agrega tu primer empleado para empezar', actionLabel: 'Agregar empleado', actionOnClick: 'openEmployeeForm()' })
 *
 * Uso (instancia):
 *   new EmptyState({ ... }).render() → HTMLElement
 */
export class EmptyState {
    constructor(props = {}) {
        this.props = props;
    }

    static template({ icon = 'inbox', title = '', description = '', actionLabel = null, actionOnClick = null, size = 'medium' } = {}) {
        const sizeMap = {
            small:  { pad: '24px 16px', iconSize: 32, titleSize: '0.95rem', descSize: '0.8rem' },
            medium: { pad: '40px 20px', iconSize: 48, titleSize: '1.05rem', descSize: '0.875rem' },
            large:  { pad: '60px 24px', iconSize: 64, titleSize: '1.25rem', descSize: '0.95rem' }
        };
        const s = sizeMap[size] || sizeMap.medium;

        const iconHTML = icons.get(icon, { size: s.iconSize }) || '';
        const action = actionLabel
            ? `<button class="empty-state-action btn-primary" ${actionOnClick ? `onclick="${actionOnClick}"` : ''} style="margin-top: 16px; padding: 10px 20px; min-height: 44px; border-radius: 8px; background: #06b6d4; color: #000; border: none; font-weight: 700; cursor: pointer;">${actionLabel}</button>`
            : '';

        return `
            <div class="empty-state" role="status" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: ${s.pad}; color: #94a3b8;">
                <div class="empty-state-icon" aria-hidden="true" style="opacity: 0.4; margin-bottom: 12px;">
                    ${iconHTML}
                </div>
                <div class="empty-state-title" style="font-size: ${s.titleSize}; font-weight: 700; color: #e2e8f0; margin-bottom: 6px;">
                    ${title}
                </div>
                ${description ? `<div class="empty-state-description" style="font-size: ${s.descSize}; line-height: 1.5; max-width: 360px;">${description}</div>` : ''}
                ${action}
            </div>
        `;
    }

    // API estática (uso preferido en templates)
    static render(props) {
        return EmptyState.template(props);
    }

    // API de instancia (para casos donde necesites HTMLElement)
    render() {
        const html = EmptyState.template(this.props);
        const tpl = document.createElement('template');
        tpl.innerHTML = html.trim();
        return tpl.content.firstChild;
    }
}

// Exponer en window para uso desde templates legacy (onclick inline, etc.)
if (typeof window !== 'undefined') {
    window.EmptyState = EmptyState;
}
