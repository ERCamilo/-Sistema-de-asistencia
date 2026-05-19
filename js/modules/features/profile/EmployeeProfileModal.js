/**
 * 👤 EmployeeProfileModal — Modal shell template.
 *
 * Renders when state.showEmployeeProfile is true. Hosts the tab navigation
 * (Resumen / Nómina / Asistencia / Documentos) and dispatches to the active
 * tab template.
 */

import { state } from '../../core/AppState.js';
import {
    ProfileTabResumen,
    ProfileTabNomina,
    ProfileTabAsistencia,
    ProfileTabDocumentos
} from './ProfileTabs.js';

export function EmployeeProfileModal() {
    if (!state.showEmployeeProfile) return '';

    const empId = state.employeeProfile.employeeId;
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return '';

    const activeTab = state.employeeProfile.activeTab;

    return `<div class="modal-overlay" data-app-close-on-self="close-employee-profile" style="z-index: 2500;">
        <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;">
            <!-- Header -->
            <div class="modal-header" style="flex-shrink: 0;">
                <button type="button" data-app-fn="close-employee-profile" aria-label="Cerrar" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 1.25rem; padding: 4px 8px;">
                    ← Volver
                </button>
                <h2 class="modal-title" style="font-size: 1.25rem;">👤 ${emp.name}</h2>
                <div style="display: flex; gap: 8px;">
                    <button type="button" data-app-fn="openEmployeeForm" data-arg="${emp.id}" aria-label="Editar empleado" style="width: 32px; height: 32px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #06b6d4;">
                        ✏️
                    </button>
                    <button type="button" class="modal-close" data-app-fn="close-employee-profile" aria-label="Cerrar">✕</button>
                </div>
            </div>

            <!-- Tabs -->
            <div style="display: flex; gap: 4px; padding: 0 20px; border-bottom: 1px solid #334155; flex-shrink: 0; overflow-x: auto;">
                <button type="button" data-app-fn="changeProfileTab" data-arg="resumen" style="padding: 12px 16px; background: ${activeTab === 'resumen' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'resumen' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'resumen' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                    📊 Resumen
                </button>
                <button type="button" data-app-fn="changeProfileTab" data-arg="nomina" style="padding: 12px 16px; background: ${activeTab === 'nomina' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'nomina' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'nomina' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                    💰 Nómina
                </button>
                <button type="button" data-app-fn="changeProfileTab" data-arg="asistencia" style="padding: 12px 16px; background: ${activeTab === 'asistencia' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'asistencia' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'asistencia' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                    📅 Asistencia
                </button>
                <button type="button" data-app-fn="changeProfileTab" data-arg="documentos" style="padding: 12px 16px; background: ${activeTab === 'documentos' ? '#1e293b' : 'transparent'}; border: none; border-bottom: 2px solid ${activeTab === 'documentos' ? '#06b6d4' : 'transparent'}; color: ${activeTab === 'documentos' ? '#06b6d4' : '#94a3b8'}; cursor: pointer; font-size: 0.875rem; font-weight: 600; white-space: nowrap;">
                    📄 Documentos
                </button>
            </div>

            <!-- Content -->
            <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 20px;">
                ${activeTab === 'resumen' ? ProfileTabResumen(emp) : ''}
                ${activeTab === 'nomina' ? ProfileTabNomina(emp) : ''}
                ${activeTab === 'asistencia' ? ProfileTabAsistencia(emp) : ''}
                ${activeTab === 'documentos' ? ProfileTabDocumentos(emp) : ''}
            </div>
        </div>
    </div>`;
}
