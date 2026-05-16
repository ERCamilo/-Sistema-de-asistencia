import { ComponentBase } from './ComponentBase.js';
import { EmptyState } from './EmptyState.js';

export class TableComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { 
        //   columns: [{ key, label, render?, sortable? }],
        //   data: [],
        //   onRowClick?, 
        //   emptyMessage?,
        //   striped?, 
        //   hoverable? 
        // }
    }

    renderHeader() {
        const { columns } = this.props;

        return `
                    <thead>
                        <tr>
                            ${columns.map(col => `
                                <th class="${col.sortable ? 'sortable' : ''}">
                                    ${col.label}
                                    ${col.sortable ? '<span class="sort-icon">⇅</span>' : ''}
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                `;
    }

    renderBody() {
        const { columns, data, onRowClick, emptyMessage } = this.props;

        if (!data || data.length === 0) {
            const emptyHTML = typeof emptyMessage === 'string'
                ? EmptyState.render({ icon: 'inbox', title: emptyMessage, size: 'medium' })
                : EmptyState.render({ icon: 'inbox', title: 'No hay datos disponibles', size: 'medium' });
            return `
                        <tbody>
                            <tr>
                                <td colspan="${columns.length}" class="empty-message" style="padding: 0;">
                                    ${emptyHTML}
                                </td>
                            </tr>
                        </tbody>
                    `;
        }

        const rows = data.map((row, index) => {
            const cells = columns.map(col => {
                const value = row[col.key];
                const rendered = col.render ? col.render(value, row, index) : value;
                return `<td>${rendered}</td>`;
            }).join('');

            const clickHandler = onRowClick ? `onclick="${onRowClick}(${JSON.stringify(row).replace(/"/g, '&quot;')})"` : '';

            return `<tr ${clickHandler}>${cells}</tr>`;
        }).join('');

        return `<tbody>${rows}</tbody>`;
    }

    render() {
        const { striped, hoverable } = this.props;
        const classes = [
            'table-component',
            striped ? 'table-striped' : '',
            hoverable ? 'table-hoverable' : ''
        ].filter(Boolean).join(' ');

        return `
                    <div class="table-wrapper responsive-table-wrapper" role="region" aria-label="Tabla de datos" tabindex="0">
                        <table class="${classes}">
                            ${this.renderHeader()}
                            ${this.renderBody()}
                        </table>
                    </div>
                `;
    }
}
