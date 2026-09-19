import {
    copyProjectStructure,
    executeProjectOnboarding
} from '../modules/features/projects/ProjectOnboarding.js';

describe('Contract F: Project onboarding copy honors legacy/default ownership', () => {
    const sourceDefault = 'PRJ-A';
    const otherProject = 'PRJ-B';
    const targetProject = 'PRJ-TARGET';

    const fixturePositions = () => ([
        { id: 'POS-LEGACY', name: 'Legacy Default', hourlyRate: 100, leaderId: 'LDR-OLD' },
        { id: 'POS-A', name: 'Scoped A', hourlyRate: 200, projectId: sourceDefault, leaderId: 'LDR-A' },
        { id: 'POS-B', name: 'Scoped B', hourlyRate: 300, projectId: otherProject, leaderId: 'LDR-B' }
    ]);

    test('default source includes legacy positions without projectId and clones them safely', async () => {
        const original = fixturePositions();
        const snapshot = JSON.parse(JSON.stringify(original));

        const result = await copyProjectStructure({
            sourceProjectId: sourceDefault,
            defaultProjectId: sourceDefault,
            targetProjectId: targetProject,
            positions: original,
            employees: [{ id: 'EMP-1', projectId: sourceDefault }]
        });

        expect(result.positions).toHaveLength(2);
        expect(result.positions.map(p => p.name).sort()).toEqual(['Legacy Default', 'Scoped A']);
        result.positions.forEach(position => {
            expect(position.projectId).toBe(targetProject);
            expect(position.leaderId).toBeNull();
            expect(['POS-LEGACY', 'POS-A']).not.toContain(position.id);
        });
        expect(result.employees).toEqual([]);
        expect(original).toEqual(snapshot);
    });

    test('non-default source excludes legacy positions without projectId', async () => {
        const original = fixturePositions();
        const result = await copyProjectStructure({
            sourceProjectId: otherProject,
            defaultProjectId: sourceDefault,
            targetProjectId: targetProject,
            positions: original
        });

        expect(result.positions).toHaveLength(1);
        expect(result.positions[0].name).toBe('Scoped B');
        expect(result.positions[0].projectId).toBe(targetProject);
        expect(result.positions[0].leaderId).toBeNull();
    });

    test('explicitly scoped source positions continue to copy when default differs', async () => {
        const original = fixturePositions();
        const result = await copyProjectStructure({
            sourceProjectId: sourceDefault,
            defaultProjectId: 'PRJ-OTHER-DEFAULT',
            targetProjectId: targetProject,
            positions: original
        });

        expect(result.positions).toHaveLength(1);
        expect(result.positions[0].name).toBe('Scoped A');
        expect(result.employees).toEqual([]);
    });

    test('executeProjectOnboarding propagates default ownership so durable copy includes legacy positions', async () => {
        const original = fixturePositions();
        const persisted = [];
        const setupService = {
            createEmptyProject: jest.fn(async () => ({
                project: { id: targetProject, name: 'Nueva Obra', status: 'active' },
                state: {
                    activeProjectId: sourceDefault,
                    defaultProjectId: sourceDefault
                }
            })),
            compensateProjectCreation: jest.fn(async () => true)
        };
        const persistenceService = {
            savePositions: jest.fn(async positions => {
                persisted.push(...positions);
                return positions;
            })
        };

        const result = await executeProjectOnboarding({
            mode: 'copy',
            projectName: 'Nueva Obra',
            setupService,
            sourceProjectId: sourceDefault,
            positions: original,
            persistenceService
        });

        expect(result.positions).toHaveLength(2);
        expect(persisted).toHaveLength(2);
        expect(persisted.map(p => p.name).sort()).toEqual(['Legacy Default', 'Scoped A']);
        expect(persisted.every(p => p.projectId === targetProject)).toBe(true);
        expect(persisted.every(p => p.leaderId === null)).toBe(true);
    });
});
