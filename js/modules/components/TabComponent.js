import { ComponentBase } from './ComponentBase.js';

export class TabComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { tabs: [], activeTab: string, onTabChange: function }
    }

    render() {
        const { tabs, activeTab, onTabChange } = this.props;

        const tabsHTML = tabs.map(tab => {
            const isActive = tab.id === activeTab;
            const activeClass = isActive ? 'tab-active' : '';

            return `
                        <button 
                            class="tab ${activeClass}" 
                            onclick="${onTabChange}('${tab.id}')"
                            data-tab="${tab.id}">
                            <span class="tab-icon">${tab.icon}</span>
                            <span class="tab-label">${tab.label}</span>
                        </button>
                    `;
        }).join('');

        return `
                    <div class="tab-container">
                        <div class="tabs">
                            ${tabsHTML}
                        </div>
                    </div>
                `;
    }
}
