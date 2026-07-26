import { Modal } from '../../components/Modal.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import {
    POSITION_ICON_OPTIONS,
    renderPositionIconSvg,
    renderPositionUiSvg
} from '../../features/employees/PositionVisuals.js';

export class PersonnelIconPickerModal {
    static open({ title, subtitle, selectedIcon, onSelect }) {
        const content = `
            <div class="position-icon-popup">
                <label class="position-icon-search">
                    ${renderPositionUiSvg('search', { size: 16 })}
                    <input type="search" data-position-icon-search
                           placeholder="Buscar icono...">
                </label>
                <div class="position-icon-filters" role="group" aria-label="Filtrar iconos">
                    <button type="button" class="active" data-icon-category="heavy">Herramientas</button>
                    <button type="button" data-icon-category="trades">Oficios</button>
                    <button type="button" data-icon-category="management">Gestión</button>
                    <button type="button" data-icon-category="other">Otros</button>
                    <button type="button" data-icon-category="all">Todos</button>
                </div>
                <div class="position-icon-picker position-icon-picker--popup">
                    ${POSITION_ICON_OPTIONS.map(option => `
                        <label class="position-icon-option"
                               data-icon-category="${option.category}"
                               data-icon-search="${option.label.toLowerCase()} ${option.keywords}"
                               title="${option.label}">
                            <input type="radio" name="quickPersonnelIcon" value="${option.value}"
                                   ${selectedIcon === option.value ? 'checked' : ''}>
                            <span>${renderPositionIconSvg(option.value, { size: 24 })}</span>
                            <small>${option.label}</small>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;

        const modal = new Modal({
            title,
            subtitle: escapeHTML(subtitle),
            content,
            size: 'small',
            buttons: null
        });
        modal.open();

        const root = modal.element;
        const search = root.querySelector('[data-position-icon-search]');
        const filterButtons = root.querySelectorAll('[data-icon-category]');
        let activeCategory = 'heavy';

        const applyFilter = () => {
            const query = (search?.value || '').trim().toLowerCase();
            filterButtons.forEach(button => {
                button.classList.toggle('active', !query && button.dataset.iconCategory === activeCategory);
            });
            root.querySelectorAll('.position-icon-option').forEach(option => {
                const selected = option.querySelector('input')?.checked;
                const matchesSearch = !query || option.dataset.iconSearch.includes(query);
                const matchesCategory = activeCategory === 'all'
                    || option.dataset.iconCategory === activeCategory;
                option.hidden = !matchesSearch || (!query && !matchesCategory && !selected);
            });
        };

        search?.addEventListener('input', applyFilter);
        filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                activeCategory = button.dataset.iconCategory;
                if (search) search.value = '';
                applyFilter();
            });
        });
        root.querySelectorAll('input[name="quickPersonnelIcon"]').forEach(input => {
            input.addEventListener('change', () => {
                onSelect(input.value);
                modal.close();
            });
        });
        applyFilter();

        return modal;
    }
}
