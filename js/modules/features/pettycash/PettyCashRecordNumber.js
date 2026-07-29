function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

export function movementCreatedAt(movement) {
    const explicit = Number(movement?.createdAt);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const match = String(movement?.id || '').match(/^mov-([0-9a-z]+)-/i);
    if (match) {
        const timestamp = Number.parseInt(match[1], 36);
        if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
    }

    const updatedAt = Number(movement?.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt;

    const invoiceDate = Date.parse(String(movement?.date || ''));
    return Number.isFinite(invoiceDate) ? invoiceDate : 0;
}

function compareMovements(left, right) {
    const timestampDiff = movementCreatedAt(left) - movementCreatedAt(right);
    if (timestampDiff !== 0) return timestampDiff;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
}

/**
 * Completa y repara números permanentes por proyecto.
 *
 * Un número válido y único nunca cambia. Ante una colisión, el movimiento más
 * antiguo conserva el número y los demás reciben números nuevos, por lo que
 * todos los dispositivos convergen al aplicar la misma lista.
 */
export function normalizePettyCashRecordNumbers(projects = [], movements = []) {
    const projectById = new Map((projects || []).map((project) => [project.id, project]));
    const movementsByProject = new Map();
    const changedProjects = [];
    const changedMovements = [];

    (movements || []).forEach((movement) => {
        const projectId = String(movement?.projectId || '');
        if (!projectId) return;
        if (!movementsByProject.has(projectId)) movementsByProject.set(projectId, []);
        movementsByProject.get(projectId).push(movement);
    });

    movementsByProject.forEach((projectMovements, projectId) => {
        const sorted = projectMovements.slice().sort(compareMovements);
        const claimed = new Set();
        const pending = [];
        let highest = positiveInteger(projectById.get(projectId)?.lastMovementRecordNumber) || 0;

        sorted.forEach((movement) => {
            const number = positiveInteger(movement.recordNumber);
            if (number && !claimed.has(number)) {
                claimed.add(number);
                highest = Math.max(highest, number);
            } else {
                pending.push(movement);
            }
        });

        pending.forEach((movement) => {
            do { highest += 1; } while (claimed.has(highest));
            claimed.add(highest);
            movement.recordNumber = highest;
            changedMovements.push(movement);
        });

        sorted.forEach((movement) => {
            if (!positiveInteger(movement.createdAt)) {
                movement.createdAt = movementCreatedAt(movement) || Date.now();
                if (!changedMovements.includes(movement)) changedMovements.push(movement);
            }
        });

        const project = projectById.get(projectId);
        if (project && positiveInteger(project.lastMovementRecordNumber) !== highest) {
            project.lastMovementRecordNumber = highest;
            project.updatedAt = Math.max(Number(project.updatedAt) || 0, Date.now());
            changedProjects.push(project);
        }
    });

    return { changedProjects, changedMovements };
}

export function allocatePettyCashRecordNumber(project, movements = [], now = Date.now()) {
    if (!project?.id) throw new Error('PROJECT_REQUIRED');
    const highestMovement = (movements || [])
        .filter((movement) => movement?.projectId === project.id)
        .reduce((highest, movement) => Math.max(highest, positiveInteger(movement.recordNumber) || 0), 0);
    const currentCounter = positiveInteger(project.lastMovementRecordNumber) || 0;
    const next = Math.max(highestMovement, currentCounter) + 1;
    project.lastMovementRecordNumber = next;
    project.updatedAt = Math.max(Number(project.updatedAt) || 0, Number(now) || Date.now());
    return next;
}

export function formatPettyCashRecordNumber(value) {
    const number = positiveInteger(value);
    return number ? `#${String(number).padStart(3, '0')}` : '#—';
}
