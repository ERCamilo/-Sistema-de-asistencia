/**
 * Abre la pantalla «Duplicados» con sus dependencias reales. Es el único punto
 * de entrada: Ajustes → Datos, el aviso del encabezado y el centro de
 * sincronización llaman a window.startMaintenanceWizard().
 */
import { state } from '../core/AppState.js';
import { DuplicatesScreen } from './DuplicatesScreen.js';
import { EmployeeRepository } from '../services/EmployeeRepository.js';
import { peekEntityScope } from '../features/projects/ProjectContext.js';
import { projectStore } from '../features/projects/ProjectStore.js';
import { isMergedAway } from '../features/employees/EmployeeMergeRegistry.js';
import {
    applyDuplicateGroupPlan, persistDuplicateResolution
} from '../features/employees/EmployeeDuplicateService.js';

let openScreen = null;

export async function openDuplicatesScreen() {
    if (openScreen?.overlay) return openScreen;
    openScreen = new DuplicatesScreen({
        peekScope: () => peekEntityScope(),
        listProjects: () => projectStore.listAll(),
        canReadCloud: () => !!globalThis.currentUser
            && typeof state.settings?.schemaVersion === 'number' && state.settings.schemaVersion >= 2,
        loadCloudEmployees: () => EmployeeRepository.loadAll(),
        isMergedAway,
        createSnapshot: async () => {
            if (globalThis.createFirebaseSnapshot) await globalThis.createFirebaseSnapshot('pre-restore', 'pre-duplicados');
        },
        applyPlan: applyDuplicateGroupPlan,
        persist: () => persistDuplicateResolution({ skipValidation: false, clearAttendance: true }),
        cloudReconcile: async () => {
            const { MaintenanceUI } = await import('./MaintenanceUI.js');
            await new MaintenanceUI().handleCloudReconcile();
        }
    });
    return openScreen.open();
}

globalThis.startMaintenanceWizard = openDuplicatesScreen;
export default openDuplicatesScreen;
