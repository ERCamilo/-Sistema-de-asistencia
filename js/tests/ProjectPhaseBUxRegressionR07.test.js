import fs from 'fs';
import path from 'path';
import { getScopedSidebarCounters } from '../modules/features/projects/EntityProjectScope.js';

const read = rel => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('R07 Phase B UX regression guard', () => {
    test('sidebar counters are scoped to the active project', () => {
        const state = {
            employees: [
                { id: 'A1', projectId: 'PRJ-A', active: true, loans: [{ status: 'active' }] },
                { id: 'A2', projectId: 'PRJ-A', active: false, loans: [{ status: 'active' }] },
                { id: 'B1', projectId: 'PRJ-B', active: true, loans: [{ status: 'active' }, { status: 'paid' }] }
            ]
        };
        expect(getScopedSidebarCounters(state, {
            enabled: true,
            projectId: 'PRJ-A',
            defaultProjectId: 'PRJ-A'
        })).toEqual({ activeEmployees: 1, activeLoans: 2 });
    });

    test('app wires scoped sidebar counts, scoped attendance detail and active-project header', () => {
        const app = read('app.js');
        expect(app).toMatch(/getScopedSidebarCounters\(state, peekEntityScope\(\)\)/);
        expect(app).toMatch(/const scopedDetailEmployees = state\.employees\.filter\(emp => entityInScope\(emp\)\)/);
        expect(app).toMatch(/existingRaw && !entityInScope\(existingRaw\)/);
        expect(app).toMatch(/activeProjectName: getHeaderActiveProjectName\(\)/);
        expect(app).toMatch(/refreshHeaderActiveProjectName\(\)/);
    });

    test('header renders the project-indicator contract and its CSS exists', () => {
        const header = read('modules/ui/Header.js');
        const css = fs.readFileSync(path.resolve(__dirname, '../../css/header.css'), 'utf8');
        expect(header).toMatch(/data-active-project-indicator/);
        expect(header).toMatch(/activeProjectName/);
        expect(css).toMatch(/\.header-project-indicator/);
        expect(css).toMatch(/\.header-project-name/);
    });

    test('project creation keeps structured onboarding while retaining dialog a11y', () => {
        const create = read('modules/features/projects/ProjectCreateUI.js');
        const list = read('modules/features/projects/ProjectListUI.js');
        expect(create).toMatch(/mountProjectOnboarding\(slot/);
        expect(create).toMatch(/attachProjectDialogA11y/);
        expect(list).toMatch(/mountProjectOnboarding\(createSlot/);
        expect(list).toMatch(/attachProjectDialogA11y/);
    });
});
