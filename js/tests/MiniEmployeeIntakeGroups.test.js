import { intakeGroupKey, groupIntakeEntries, summarizeIntakeGroups } from '../modules/features/p2p/MiniEmployeeIntakeGroups.js';

const row = (id, number, name) => ({ miniLocalId: id, number, name });
const entry = (id, peerId, rows, extra = {}) => ({ id, peerId, peerName: extra.peerName || peerId, status: 'pending', mappings: [], receivedAt: extra.receivedAt || 1, payload: { saProjectId: extra.project || 'P-1', employees: rows }, ...extra });

test('los orígenes sintéticos (texto pegado y asistencia sin Mini) forman un solo grupo', () => {
    expect(intakeGroupKey({ peerId: 'mini-1' })).toBe('mini-1');
    expect(intakeGroupKey({ peerId: 'attendance:texto' })).toBe('text');
    expect(intakeGroupKey({ peerId: 'attendance:dispositivo-x' })).toBe('text');
});

test('agrupa por Mini y deja el texto aparte, Minis por nombre y texto al final', () => {
    const groups = groupIntakeEntries([
        entry('a', 'mini-2', [row('1', '1', 'Ana')], { peerName: 'Zeta' }),
        entry('b', 'attendance:texto', [row('t1', '5', 'Luis'), row('t2', '6', 'Eva')], { local: true, peerName: 'Texto pegado de Mini' }),
        entry('c', 'mini-1', [row('1', '2', 'Beto')], { peerName: 'Alfa' }),
        entry('d', 'mini-1', [row('2', '3', 'Carla')], { peerName: 'Alfa', receivedAt: 5 }),
        entry('e', 'mini-3', [row('9', '9', 'Ya')], { status: 'resolved' })
    ], { projectId: 'P-1' });
    expect(groups.map(g => [g.key, g.kind, g.label])).toEqual([['mini-1', 'mini', 'Alfa'], ['mini-2', 'mini', 'Zeta'], ['text', 'text', 'Texto pegado']]);
    expect(groups[0].entries.map(e => e.id)).toEqual(['d', 'c']);
    expect(groups[0].pendingEmployees).toBe(2);expect(groups[2].pendingEmployees).toBe(2);
});

test('los empleados ya resueltos no cuentan como pendientes', () => {
    const [group] = groupIntakeEntries([entry('a', 'mini-1', [row('1', '1', 'Ana'), row('2', '2', 'Beto')], { mappings: [{ miniLocalId: '1', saEmployeeId: 'e1' }] })], { projectId: 'P-1' });
    expect(group.totalEmployees).toBe(2);expect(group.pendingEmployees).toBe(1);
});

test('una obra distinta queda marcada para cambiar de obra', () => {
    const [group] = groupIntakeEntries([entry('a', 'mini-1', [row('1', '1', 'Ana')], { project: 'P-2' })], { projectId: 'P-1' });
    expect(group.otherProject).toBe(true);
});

test('el resumen cuenta empleados y orígenes para una sola notificación', () => {
    const groups = groupIntakeEntries([entry('a', 'mini-1', [row('1', '1', 'Ana')]), entry('b', 'attendance:texto', [row('t', '2', 'Beto'), row('u', '3', 'Eva')], { local: true })], { projectId: 'P-1' });
    expect(summarizeIntakeGroups(groups)).toEqual({ employees: 3, origins: 2, text: 'Personal por revisar: 3 empleados de 2 orígenes' });
    expect(summarizeIntakeGroups(groups.slice(0, 1)).text).toBe('Personal por revisar: 1 empleado de 1 origen');
    expect(summarizeIntakeGroups([])).toEqual({ employees: 0, origins: 0, text: '' });
});
