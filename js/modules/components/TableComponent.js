import { ComponentBase } from './ComponentBase.js';

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
            return `
                        <tbody>
                            <tr>
                                <td colspan="${columns.length}" class="empty-message">
                                    ${emptyMessage || 'No hay datos disponibles'}
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
                    <div class="table-wrapper">
                        <table class="${classes}">
                            ${this.renderHeader()}
                            ${this.renderBody()}
                        </table>
                    </div>
                `;
    }
}
