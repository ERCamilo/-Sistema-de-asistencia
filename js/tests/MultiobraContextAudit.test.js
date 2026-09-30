
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { ProjectContextService, projectContext, getEntityScope, ACTIVE_PROJECT_LS_KEY } from '../modules/features/projects/ProjectContext.js';
import { replaceEntityScope, resetEntityScope, peekEntityScope, getScopedEmployees } from '../modules/features/projects/EntityProjectScope.js';

const project = id => ({ id, name: id, status: 'active' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let originalStore, originalDefaults;
beforeEach(() => {
    originalStore = projectContext.store;
    originalDefaults = projectContext.defaults;
    localStorage.clear();
    setProjectsEnabled(true);
    replaceEntityScope({ enabled: true, projectId: 'INITIAL', defaultProjectId: 'INITIAL' });
    localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'INITIAL');
});
afterEach(() => {
    projectContext.store = originalStore;
    projectContext.defaults = originalDefaults;
    resetEntityScope();
    localStorage.clear();
});

test('CONTROL: sequential selection keeps preference and synchronous scope aligned', async () => {
    const context = new ProjectContextService({ store: { get: async id => project(id) } });
    await context.setActiveProjectId('A');
    await context.setActiveProjectId('B');
    expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('B');
    expect(peekEntityScope().projectId).toBe('B');
});

test('R6: late validation of an earlier selection must not undo the latest selection', async () => {
    const reached = deferred(), release = deferred();
    const context = new ProjectContextService({
        store: { get: async id => { if (id === 'A') { reached.resolve(); await release.promise; } return project(id); } }
    });
    const pending = context.setActiveProjectId('A');
    try { await reached.promise; await context.setActiveProjectId('B'); }
    finally { release.resolve(); }
    await pending;
    expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('B');
    expect(peekEntityScope().projectId).toBe('B');
});

test('R6: an old scope resolution must not restore A after B becomes active', async () => {
    const reached = deferred(), release = deferred();
    localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'A');
    replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'INITIAL' });
    projectContext.store = { get: async id => project(id) };
    projectContext.defaults = { ensureDefaultProject: async () => { reached.resolve(); await release.promise; return project('INITIAL'); } };
    const pending = getEntityScope();
    try { await reached.promise; await projectContext.setActiveProjectId('B'); }
    finally { release.resolve(); }
    await pending;
    expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('B');
    expect(peekEntityScope().projectId).toBe('B');
    expect(getScopedEmployees({ employees: [{ id: 'EMP-A', projectId: 'A' }, { id: 'EMP-B', projectId: 'B' }] }).map(e => e.id)).toEqual(['EMP-B']);
});
