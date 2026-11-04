import { renderProjectItemHTML, mountProjectList } from '../modules/features/projects/ProjectListUI.js';

const DAY = 86400000;
const NOW = Date.now();
const base = extra => ({
    id: 'B', name: 'Obra en pausa', status: 'closed',
    closedAt: NOW - 31 * DAY, createdAt: 1, updatedAt: 2, ...extra
});
const verifiedEmpty = { B: { verified: true, empty: true,
    employees: 0, positions: 0, leaders: 0, attendance: 0,
    loans: 0, payrollClosures: 0, pettyCash: 0, other: 0, pending: 0 } };
const options = { activeProjectId: 'A', defaultProjectId: 'A', allowSwitch: true, usage: verifiedEmpty, now: NOW };
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
async function waitFor(predicate) {
    for (let n = 0; n < 100; n++) {
        if (predicate()) return;
        await tick();
    }
    throw new Error('No se actualizó la interfaz');
}

describe('interfaz del borrado de obra en dos períodos de 30 días', () => {
    afterEach(() => { document.body.innerHTML = ''; });
    test('no permite solicitar eliminación antes de 30 días de pausa', () => {
        const html = renderProjectItemHTML(base({ closedAt: NOW - 29 * DAY }), options);
        expect(html).toContain('data-project-deletion-policy="paused-wait"');
        expect(html).not.toContain('data-project-request-delete');
        expect(html).not.toContain('data-project-delete="B"');
    });
    test('30 días en pausa habilitan solicitar, nunca borrar directamente', () => {
        const html = renderProjectItemHTML(base(), options);
        expect(html).toContain('data-project-request-delete="B"');
        expect(html).not.toContain('data-project-delete="B"');
        expect(html).toContain('otros 30 días para cancelarla');
    });
    test('solicitud muestra cancelación durante 30 días adicionales', () => {
        const html = renderProjectItemHTML(base({
            closedAt: NOW - 50 * DAY, deletionRequestedAt: NOW - 10 * DAY
        }), options);
        expect(html).toContain('data-project-deletion-policy="grace-period"');
        expect(html).toContain('data-project-cancel-request="B"');
        expect(html).not.toContain('data-project-delete="B"');
    });
    test('tras 60+ días, únicamente una obra vacía puede finalizar su baja del catálogo', () => {
        const row = base({ closedAt: NOW - 80 * DAY, deletionRequestedAt: NOW - 31 * DAY });
        const empty = renderProjectItemHTML(row, options);
        expect(empty).toContain('data-project-delete="B"');
        const occupied = renderProjectItemHTML(row, { ...options, usage: {
            B: { ...verifiedEmpty.B, empty: false, payrollClosures: 5 }
        } });
        expect(occupied).not.toContain('data-project-delete="B"');
        expect(occupied).toContain('No existe borrado automático con historial');
        expect(occupied).toContain('data-project-cancel-request="B"');
    });
    test('solicitar y cancelar exige el servicio, no llama el borrado', async () => {
        document.body.innerHTML = '<div id="list"></div>';
        const container = document.getElementById('list');
        let current = base();
        const service = {
            getProjectUsage: jest.fn(async () => verifiedEmpty),
            getState: jest.fn(async () => ({ projects: [current], activeProjectId: 'A', defaultProjectId: 'A' })),
            deleteEmptyProject: jest.fn(),
            changeProjectDeletionRequest: jest.fn(async (id, { cancel }) => {
                if (id !== 'B') throw new Error('Obra equivocada');
                current = { ...current, deletionRequestedAt: cancel ? null : Date.now() };
                return { state: { projects: [current], activeProjectId: 'A', defaultProjectId: 'A' } };
            })
        };
        mountProjectList(container, { projects: [current], allowSwitch: true, setupService: service,
            activeProjectId: 'A', defaultProjectId: 'A' });
        await waitFor(() => container.querySelector('[data-project-request-delete]'));
        container.querySelector('[data-project-request-delete]').click();
        expect(service.changeProjectDeletionRequest).not.toHaveBeenCalled();
        container.querySelector('[data-project-request-confirm]').click();
        await waitFor(() => container.querySelector('[data-project-cancel-request]'));
        expect(service.changeProjectDeletionRequest).toHaveBeenCalledWith('B', { cancel: false });
        expect(container.querySelector('[data-project-delete]')).toBeNull();
        container.querySelector('[data-project-cancel-request]').click();
        await waitFor(() => container.querySelector('[data-project-request-delete]'));
        expect(service.changeProjectDeletionRequest).toHaveBeenCalledWith('B', { cancel: true });
        expect(service.deleteEmptyProject).not.toHaveBeenCalled();
    });
});
