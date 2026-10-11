/**
 * Barra inferior de 6 pestañas (la de siempre) y la elección entre ella y
 * la barra de 5 posiciones (BottomNav.js), que se activa como prueba desde
 * Configuración → Tests (`settings.newBottomNav`).
 *
 * Probado en js/tests/BottomNavSelection.test.js.
 */
import { renderBottomNav } from './BottomNav.js';

export function renderLegacyBottomNav(state, icons) {
    return `<nav class="bottom-nav glass-effect">
                <button class="bottom-nav-tab ${state.activeTab === 'attendance' ? 'active' : ''}" 
                        type="button" data-app-fn="changeTab" data-arg="attendance"
                        title="Registrar asistencia diaria">
                    <span class="bottom-nav-icon">${icons.get('attendance')}</span>
                    <span class="bottom-nav-text">Asistencia</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'employees' || state.activeTab === 'positions' ? 'active' : ''}" 
                        type="button" data-app-fn="openEmpleadosPersonal"
                        title="Gestionar empleados y posiciones">
                    <span class="bottom-nav-icon">${icons.get('personnel')}</span>
                    <span class="bottom-nav-text">Personal</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'employee-report' || state.activeTab === 'dashboard' ? 'active' : ''}" 
                        type="button" data-app-fn="changeTab" data-arg="employee-report"
                        title="Ver reportes y estadísticas">
                    <span class="bottom-nav-icon">${icons.get('reports')}</span>
                    <span class="bottom-nav-text">Reportes</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'export' ? 'active' : ''}" 
                        type="button" data-app-fn="openNomina"
                        title="Nómina">
                    <span class="bottom-nav-icon">${icons.get('payroll')}</span>
                    <span class="bottom-nav-text">Nómina</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'pettycash' ? 'active' : ''}"
                        type="button" data-app-fn="changeTab" data-arg="pettycash"
                        title="Caja Chica">
                    <span class="bottom-nav-icon">${icons.get('dollar')}</span>
                    <span class="bottom-nav-text">Caja</span>
                </button>
                <button class="bottom-nav-tab ${state.activeTab === 'settings' ? 'active' : ''}"
                        type="button" data-app-fn="openAjustesGenerales"
                        title="Configuración del sistema">
                    <span class="bottom-nav-icon">${icons.get('settings')}</span>
                    <span class="bottom-nav-text">Ajustes</span>
                </button>
            </nav>`;
}

/**
 * @param {object} state
 * @param {object} env { icons, voiceAvailable, online, micDenied }
 */
export function chooseBottomNav(state, { icons, ...env } = {}) {
    return state.settings?.newBottomNav === true
        ? renderBottomNav(state, env)
        : renderLegacyBottomNav(state, icons);
}
