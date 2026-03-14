import { ComponentBase } from './ComponentBase.js';

export class StatCardComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { icon, label, value, trend?, color? }
    }

    render() {
        const { icon, label, value, trend, color } = this.props;
        const colorClass = color ? `stat-card-${color}` : '';

        return `
                    <div class="stat-card ${colorClass}">
                        <div class="stat-icon">${icon}</div>
                        <div class="stat-content">
                            <div class="stat-label">${label}</div>
                            <div class="stat-value">${value}</div>
                            ${trend ? `<div class="stat-trend ${trend.direction}">${trend.text}</div>` : ''}
                        </div>
                    </div>
                `;
    }
}
