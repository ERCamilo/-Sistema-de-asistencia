/**
 * 🏠 COMPONENTE RAÍZ: APP (Fase 3 - Modularización)
 * Este es el componente maestro que orquestra el renderizado de toda la aplicación.
 */

import { state } from '../core/AppState.js';
import * as MainComponents from '../ui/QuickViewComponents.js';

// Delegación pequeña para botones globales del componente raíz
let _appDelegationAttached = false;
if (!_appDelegationAttached) {
    document.addEventListener('click', (e) => {
        const t = e.target.closest('[data-app-action]');
        if (!t) return;
        const action = t.dataset.appAction;
        if (action === 'show-confirm-reset') window.showConfirmReset?.();
        else if (action === 'toggle-bottom-nav') window.toggleBottomNav?.();
    });
    _appDelegationAttached = true;
}
import * as SyncUI from '../ui/SyncUI.js';
import * as EmployeesUI from '../features/employees/EmployeesUI.js';
import * as AnalyticsUI from '../features/analytics/AnalyticsUI.js';
import * as PayrollUI from '../features/payroll/PayrollUI.js';
import { Header } from '../ui/Header.js';
import { 
    payrollService, 
    holidayService,
    dataService,
    attendanceService,
    storageService,
    chartService
} from '../services/index.js';
import { saveApplicationData } from '../services/PersistenceService.js';

/**
 * Componente principal de la aplicación
 */
export function App() {
    // 🔧 INICIALIZACIÓN DE CONTEXTO PARA MÓDULOS UI
    const context = {
        state,
        services: {
            payroll: payrollService,
            holiday: holidayService,
            data: dataService,
            attendance: attendanceService,
            storage: storageService,
            chart: chartService
        },
        saveToLocalStorage: saveApplicationData
    };

    // Inicializar sub-módulos
    SyncUI.initSyncUI(context);
    EmployeesUI.init(context);
    AnalyticsUI.init(context);
    PayrollUI.init(context);

    // Si está el onboarding activo, mostrar solo eso
    if (state.showOnboarding) {
        return `
            <div class="overlay" style="background: #0f172a; z-index: 10000;">
                <div style="max-width: 100%; height: 100vh; overflow-y: auto;">
                    ${window.onboardingWizard?.renderStep() || ''}
                </div>
            </div>
        `;
    }

    // Banner de modo demo si está activo
    const demoBanner = state.usingDemoData ? `
        <div class="demo-mode-banner">
            <span>⚠️ MODO DEMO ACTIVO</span>
            <span style="opacity: 0.8;">Los cambios NO se guardarán</span>
            <button type="button" data-app-action="show-confirm-reset" class="btn-demo-reset">🔄 Reiniciar</button>
        </div>
    ` : '';

    // ⚡ OPTIMIZACIÓN: Mapeo de pestañas
    const tabMap = {
        'attendance': () => MainComponents.AttendanceTab(),
        'employees': () => EmployeesUI.EmployeesTab(),
        'positions': () => {
            state.employeeViewMode = 'positions';
            return EmployeesUI.EmployeesTab();
        },
        'employee-report': () => AnalyticsUI.ReportsTab(),
        'dashboard': () => {
            state.reportViewMode = 'dashboard';
            return AnalyticsUI.ReportsTab();
        },
        'export': () => PayrollUI.PayrollTab(),
        'settings': () => MainComponents.SettingsTab()
    };

    // Renderizado del contenido activo
    const content = tabMap[state.activeTab]
        ? tabMap[state.activeTab]()
        : '<div class="empty-state">🚧 En desarrollo</div>';

    // ⚡ Mapeo de modales
    const modalMap = {
        'advanced': () => MainComponents.AdvancedAttendanceModal(),
        'employee-form': () => MainComponents.EmployeeFormModal(),
        'leader-form': () => MainComponents.LeaderFormModal(),
        'position-form': () => MainComponents.PositionFormModal(),
        'multi-position': () => MainComponents.MultiPositionModal()
    };

    const modal = (state.showModal && modalMap[state.modalType])
        ? modalMap[state.modalType]()
        : '';

    // Ensamblaje final
    return `
        ${demoBanner}
        ${Header({
            companyName: state.settings.companyName,
            SyncIndicator: SyncUI.SyncIndicator,
            openNotesCenter: () => window.openNotesCenter(),
            exportData: () => window.exportExcel(),
            activeTab: state.activeTab,
            changeTab: (tab) => window.changeTab(tab),
            legacyNavigation: state.settings.legacyNavigation
        })}
        <main class="main-content" ${state.settings.legacyNavigation ? 'style="padding-bottom: 24px;"' : ''}>
            <div class="container">${content}</div>
        </main>
        ${state.settings.legacyNavigation ? '' : MainComponents.BottomNavigation()}
        ${!state.settings.legacyNavigation ? '<button type="button" class="landscape-toggle-btn" data-app-action="toggle-bottom-nav" aria-label="Mostrar/Ocultar Menú">☰</button>' : ''}
        ${MainComponents.FloatingCard()}
        ${MainComponents.EmployeeProfileModal()}
        ${modal}
        ${MainComponents.ContextMenu()}
        ${MainComponents.ExportMenu()}
        ${MainComponents.ImportFullModal()}
        ${MainComponents.NotesCenterModal()}
        ${MainComponents.NoteModal()}
    `;
}

