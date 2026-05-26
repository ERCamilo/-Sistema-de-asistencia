import icons from './IconSystem.js';

// ============================================
// 🎯 EVENT DELEGATION (data-header-action)
// ============================================
const _HEADER_ACTION_MAP = {
    'open-notes-center': () => window.openNotesCenter?.(),
    'export-data': () => window.exportData?.(),
    'change-tab': (tab) => window.changeTab?.(tab)
};

function _handleHeaderClick(e) {
    const target = e.target.closest('[data-header-action]');
    if (!target) return;
    const action = target.dataset.headerAction;
    const handler = _HEADER_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

let _headerDelegationAttached = false;
function _attachHeaderDelegation() {
    if (_headerDelegationAttached) return;
    document.addEventListener('click', _handleHeaderClick);
    _headerDelegationAttached = true;
}
_attachHeaderDelegation();

/**
 * Componente Header - Rediseñado según referencia visual
 * Proporciona el encabezado principal con logo, sincronización y acciones.
 */
// Map of tab id → subtitle shown below the company name. Helps the user
// always know where they are in the app, especially with the sidebar
// active. Falls back to '' for unknown tabs.
const _HEADER_SUBTITLE = {
    'attendance': 'Asistencia',
    'employees': 'Personal',
    'positions': 'Personal · Puestos',
    'employee-report': 'Reportes',
    'dashboard': 'Reportes',
    'export': 'Nómina',
    'settings': 'Ajustes'
};

// Build the small "Erlin C." pill on the right, based on the Firebase user.
// Falls back to empty markup if no one is signed in.
function _renderUserPill() {
    const u = (typeof window !== 'undefined') ? window.currentUser : null;
    if (!u) return '';
    const displayName = u.displayName || u.email || 'Usuario';
    // Compact name: "Erlin C." from "Erlin Camilo"
    const parts = displayName.split(/\s+/).filter(Boolean);
    const compact = parts.length >= 2
        ? `${parts[0]} ${parts[1][0]}.`
        : parts[0] || 'Usuario';
    const initials = (parts[0]?.[0] || 'U').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
    const avatar = u.photoURL
        ? `<img src="${u.photoURL}" alt="" class="header-user-avatar-img" onerror="this.style.display='none'">`
        : `<span class="header-user-avatar">${initials}</span>`;
    return `<div class="header-user-pill" title="${displayName}">
                ${avatar}
                <span class="header-user-name">${compact}</span>
            </div>`;
}

export const Header = ({
    companyName,
    SyncIndicator,
    openNotesCenter,
    exportData,
    activeTab,
    changeTab,
    legacyNavigation
}) => {
    const subtitle = _HEADER_SUBTITLE[activeTab] || '';
    return `
        <header class="header glass-effect">
            <div class="container">
                <div class="header-content">
                    <div class="header-left">
                        <div class="header-logo">C</div>
                        <div class="header-brand-block">
                            <h1 class="company-name">${companyName || 'Contrutek'}</h1>
                            ${subtitle ? `<div class="header-context-sub">${subtitle}</div>` : ''}
                        </div>
                    </div>
                    <div class="header-right">
                        ${SyncIndicator ? SyncIndicator() : ''}

                        ${window._systemAlerts ? window._systemAlerts.renderAlertButton() : ''}

                        <button class="header-icon-btn" type="button" data-header-action="open-notes-center" aria-label="Notas" title="Notas">
                            <span class="header-icon-emoji">📝</span>
                        </button>

                        <button class="header-icon-btn primary" type="button" data-header-action="export-data" aria-label="Exportar Backup" title="Exportar Backup">
                            ${icons.get('download', { size: 20 })}
                        </button>

                        ${_renderUserPill()}
                    </div>
                </div>

                ${legacyNavigation ? `
                <div class="nav-tabs-container">
                    <div class="nav-tabs">
                        <button class="nav-tab ${activeTab === 'attendance' ? 'active' : ''}" type="button" data-header-action="change-tab" data-value="attendance">
                            ${icons.get('attendance', { size: 18 })}<span class="tab-text"> Asistencia</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'employees' ? 'active' : ''}" type="button" data-header-action="change-tab" data-value="employees">
                            ${icons.get('personnel', { size: 18 })}<span class="tab-text"> Personal</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'employee-report' ? 'active' : ''}" type="button" data-header-action="change-tab" data-value="employee-report">
                            ${icons.get('reports', { size: 18 })}<span class="tab-text"> Reportes</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'export' ? 'active' : ''}" type="button" data-header-action="change-tab" data-value="export">
                            ${icons.get('payroll', { size: 18 })}<span class="tab-text"> Nómina</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'settings' ? 'active' : ''}" type="button" data-header-action="change-tab" data-value="settings">
                            ${icons.get('settings', { size: 18 })}<span class="tab-text"> Ajustes</span>
                        </button>
                    </div>
                </div>
                ` : ''}
            </div>
        </header>
    `;
};
