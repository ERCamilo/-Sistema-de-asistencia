import { ComponentBase } from './ComponentBase.js';

// Delegación genérica para onTabChange (resuelve window[fnName])
let _tabDelegationAttached = false;
if (!_tabDelegationAttached) {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab-change]');
        if (!btn) return;
        const fnName = btn.dataset.tabChange;
        const tabId = btn.dataset.tab;
        const fn = window[fnName];
        if (typeof fn === 'function') fn(tabId);
    });
    _tabDelegationAttached = true;
}

export class TabComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { tabs: [], activeTab: string, onTabChange: string (window fn name) }
    }

    render() {
        const { tabs, activeTab, onTabChange } = this.props;

        const tabsHTML = tabs.map(tab => {
            const isActive = tab.id === activeTab;
            const activeClass = isActive ? 'tab-active' : '';

            return `
                        <button
                            type="button"
                            class="tab ${activeClass}"
                            data-tab-change="${onTabChange}"
                            data-tab="${tab.id}"
                            aria-selected="${isActive}">
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
