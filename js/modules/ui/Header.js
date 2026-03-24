import { icons } from './IconSystem.js';

/**
 * Componente Header - Rediseñado según referencia visual
 * Proporciona el encabezado principal con logo, sincronización y acciones.
 */
export const Header = ({ 
    companyName, 
    SyncIndicator, 
    openNotesCenter, 
    exportData, 
    activeTab, 
    changeTab, 
    legacyNavigation 
}) => {
    return `
        <header class="header">
            <div class="container">
                <div class="header-content">
                    <div class="header-left">
                        <div class="header-logo">C</div>
                        <h1 class="company-name">${companyName || 'Contrutek'}</h1>
                    </div>
                    <div class="header-right">
                        ${SyncIndicator ? SyncIndicator() : ''}
                        
                        <button class="header-icon-btn" onclick="openNotesCenter()" title="Notas">
                            ${icons.get('mail', { size: 20 })}
                        </button>
                        
                        <button class="header-icon-btn primary" onclick="exportData()" title="Exportar Backup">
                            ${icons.get('download', { size: 20 })}
                        </button>
                    </div>
                </div>

                ${legacyNavigation ? `
                <div class="nav-tabs-container">
                    <div class="nav-tabs">
                        <button class="nav-tab ${activeTab === 'attendance' ? 'active' : ''}" onclick="changeTab('attendance')">
                            ${icons.get('attendance', { size: 18 })}<span class="tab-text"> Asistencia</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'employees' ? 'active' : ''}" onclick="changeTab('employees')">
                            ${icons.get('personnel', { size: 18 })}<span class="tab-text"> Personal</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'employee-report' ? 'active' : ''}" onclick="changeTab('employee-report')">
                            ${icons.get('reports', { size: 18 })}<span class="tab-text"> Reportes</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'export' ? 'active' : ''}" onclick="changeTab('export')">
                            ${icons.get('payroll', { size: 18 })}<span class="tab-text"> Nómina</span>
                        </button>
                        <button class="nav-tab ${activeTab === 'settings' ? 'active' : ''}" onclick="changeTab('settings')">
                            ${icons.get('settings', { size: 18 })}<span class="tab-text"> Ajustes</span>
                        </button>
                    </div>
                </div>
                ` : ''}
            </div>
        </header>
    `;
};
