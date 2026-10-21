import {
    buildCandidateLists, positionDailySuggestion, stepsFor, intakeAliasScope, aliasRecordsForLinks
} from '../modules/features/p2p/MiniEmployeeIntakeSteps.js';

const scope = { enabled: true, projectId: 'P-1' };
const emp = (id, number, name, extra = {}) => ({ id, number, name, projectId: 'P-1', ...extra });

describe('buildCandidateLists', () => {
    const employees = [
        emp('e10', '10', 'Zoila Pérez'), emp('e2', '2', 'Juan Gómez'), emp('e5', '5', 'Ana Ruiz', { active: false }),
        emp('e7', '7', 'Juan Gomez Perez'), emp('e3', '3', 'Borrado', { deletedAt: 1 })
    ];
    test('similar: mismo número o nombre parecido, ordenado por ficha, con marca de mismo número', () => {
        const { similar } = buildCandidateLists({ number: '10', name: 'Juan Gómez' }, employees, scope);
        expect(similar.map(c => c.employee.id)).toEqual(['e2', 'e10']);
        expect(similar.find(c => c.employee.id === 'e10').sameNumber).toBe(true);
        expect(similar.find(c => c.employee.id === 'e2').sameNumber).toBe(false);
    });
    test('all: todos los vivos, incluso pausados, ordenados numéricamente', () => {
        const { all } = buildCandidateLists({ number: '99', name: 'Nadie' }, employees, scope);
        expect(all.map(c => c.employee.id)).toEqual(['e2', 'e5', 'e7', 'e10']);
        expect(all.find(c => c.employee.id === 'e5').paused).toBe(true);
    });
});

test('positionDailySuggestion convierte la tarifa por hora del puesto a diaria', () => {
    expect(positionDailySuggestion({ hourlyRate: 112.5 }, 8)).toBe(900);
    expect(positionDailySuggestion({}, 8)).toBeNull();
    expect(positionDailySuggestion(null, 8)).toBeNull();
});

test('stepsFor: pasos según lo que se quiere hacer', () => {
    expect(stepsFor({ action: 'pending' })).toEqual(['action']);
    expect(stepsFor({ action: 'link' })).toEqual(['action', 'target', 'confirm']);
    expect(stepsFor({ action: 'create' })).toEqual(['action', 'position', 'salary', 'details']);
    expect(stepsFor({ action: '' })).toEqual(['action']);
});

describe('alias de vínculos', () => {
    test('scope: peer real, y texto pegado con el scope por defecto', () => {
        expect(intakeAliasScope({ peerId: 'mini-1' }, 'owner', 'P-1')).toEqual({ ownerUid: 'owner', siteId: 'P-1', sourceId: 'peer:mini-1' });
        expect(intakeAliasScope({ peerId: 'attendance:texto' }, 'owner', 'P-1')).toEqual({ ownerUid: 'owner', siteId: 'sa-current-site', sourceId: 'mini-whatsapp' });
        expect(intakeAliasScope({ peerId: 'attendance:otro' }, 'owner', 'P-1')).toBeNull();
    });
    test('solo se guardan vínculos a un empleado con otra ficha', () => {
        const entry = { peerId: 'mini-1', payload: { employees: [
            { miniLocalId: 'm1', number: '4', name: 'Ana' }, { miniLocalId: 'm2', number: '8', name: 'Luis' }, { miniLocalId: 'm3', number: '9', name: 'Eva' }
        ] } };
        const decisions = [{ miniLocalId: 'm1', action: 'link', employeeId: 'e1' }, { miniLocalId: 'm2', action: 'link', employeeId: 'e2' }, { miniLocalId: 'm3', action: 'create' }];
        const employees = [emp('e1', '40', 'Ana M'), emp('e2', '8', 'Luis')];
        const records = aliasRecordsForLinks(entry, decisions, employees, 'owner', 'P-1');
        expect(records).toEqual([{
            scope: { ownerUid: 'owner', siteId: 'P-1', sourceId: 'peer:mini-1' }, rawNumber: '4', rawName: 'Ana',
            targetEmployeeId: 'e1', targetNumberSnapshot: '40', targetNameSnapshot: 'Ana M'
        }]);
    });
});
