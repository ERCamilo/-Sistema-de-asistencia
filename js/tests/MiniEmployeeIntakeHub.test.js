import { renderIntakeHub } from '../modules/features/p2p/MiniEmployeeIntakeHub.js';
import { groupIntakeEntries } from '../modules/features/p2p/MiniEmployeeIntakeGroups.js';

const row = (id, n) => ({ miniLocalId: id, number: String(n), name: `Emp ${n}` });
const entry = (id, peerId, rows, extra = {}) => ({ id, peerId, peerName: extra.peerName || peerId, status: 'pending', mappings: [], receivedAt: extra.receivedAt || 1, payload: { saProjectId: extra.project || 'P-1', employees: rows }, ...extra });
let host, onOpenEntry, onBack;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); onOpenEntry = jest.fn(); onBack = jest.fn(); });
afterEach(() => { document.body.innerHTML = ''; });
const render = entries => renderIntakeHub(host, { groups: groupIntakeEntries(entries, { projectId: 'P-1' }), projectName: 'Obra 1', onOpenEntry, onBack });

test('muestra un resumen único y un grupo por Mini más el de texto', () => {
    render([entry('a', 'm1', [row('1', 1)], { peerName: 'Mini Uno' }), entry('b', 'm2', [row('1', 2), row('2', 3)], { peerName: 'Mini Dos' }), entry('t', 'attendance:texto', [row('t', 4)], { local: true })]);
    expect(host.querySelector('[data-intake-hub-summary]').textContent).toBe('Personal por revisar: 4 empleados de 3 orígenes');
    expect([...host.querySelectorAll('[data-intake-group]')].map(el => el.dataset.intakeGroup)).toEqual(['m2', 'm1', 'text']);
    expect(host.querySelector('[data-intake-group="m2"]').textContent).toContain('2 empleados pendientes');
    expect(host.querySelector('[data-intake-group="text"]').textContent).toContain('Texto pegado');
});

test('un grupo con un solo envío lo abre directamente', () => {
    const only = entry('a', 'm1', [row('1', 1)]);
    render([only]);
    host.querySelector('[data-intake-group-open="m1"]').click();
    expect(onOpenEntry).toHaveBeenCalledWith(only);
});

test('un grupo con varios envíos pide elegir cuál abrir y permite volver a los grupos', () => {
    const older = entry('a', 'm1', [row('1', 1)], { receivedAt: 1 }), newer = entry('b', 'm1', [row('2', 2), row('3', 3)], { receivedAt: 9 });
    render([older, newer]);
    host.querySelector('[data-intake-group-open="m1"]').click();
    expect(onOpenEntry).not.toHaveBeenCalled();
    const items = [...host.querySelectorAll('[data-intake-entry-open]')];
    expect(items.map(el => el.dataset.intakeEntryOpen)).toEqual(['b', 'a']);
    items[0].click();expect(onOpenEntry).toHaveBeenCalledWith(newer);
    host.querySelector('[data-intake-hub-back]').click();
    expect(host.querySelector('[data-intake-group="m1"]')).not.toBeNull();expect(onBack).not.toHaveBeenCalled();
});

test('los envíos de otra obra no se pueden abrir', () => {
    render([entry('a', 'm1', [row('1', 1)], { project: 'P-2' })]);
    expect(host.querySelector('[data-intake-group-open="m1"]').disabled).toBe(true);
    expect(host.querySelector('[data-intake-group="m1"]').textContent).toContain('Cambia a la obra de destino');
});

test('sin pendientes se muestra vacío y volver sale del centro', () => {
    render([]);
    expect(host.textContent).toContain('No hay personal por revisar');
    host.querySelector('[data-intake-hub-back]').click();expect(onBack).toHaveBeenCalled();
});
