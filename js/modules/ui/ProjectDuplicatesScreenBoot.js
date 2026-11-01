/**
 * Abre la pantalla «Obras repetidas» con sus dependencias reales. Se llama desde
 * Ajustes → Proyectos (con la bandera `project_duplicates` encendida).
 */
import { state } from '../core/AppState.js';
import { ProjectDuplicatesScreen } from './ProjectDuplicatesScreen.js';
import { peekEntityScope } from '../features/projects/ProjectContext.js';
import { projectStore } from '../features/projects/ProjectStore.js';
import { dismissProjectPair } from '../features/projects/ProjectPairDismissals.js';

let openScreen = null;

export async function openProjectDuplicatesScreen({ onClose } = {}) {
    if (openScreen?.overlay) return openScreen;
    openScreen = new ProjectDuplicatesScreen({
        peekScope: () => peekEntityScope(),
        listProjects: () => projectStore.listAll(),
        getEmployees: () => state.employees || [],
        getAttendance: () => state.attendance || {},
        dismissPair: (idA, idB) => dismissProjectPair(idA, idB),
        onClose
    });
    return openScreen.open();
}

globalThis.openProjectDuplicatesScreen = openProjectDuplicatesScreen;
export default openProjectDuplicatesScreen;
