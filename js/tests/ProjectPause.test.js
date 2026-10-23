import { Project } from '../modules/features/projects/Project.js';
import { planCatalogMerge, toCatalogDoc } from '../modules/features/projects/ProjectCatalogSync.js';

test('pause and resume preserve identity and data and round trip', () => {
    const project = Project.create({ id: 'a', name: 'Obra', metadata: { notes: 'keep' } });
    project.pause();
    expect(Project.fromJSON(project.toJSON()).status).toBe('paused');
    expect(() => project.pause()).toThrow();
    const paused = project.toJSON();
    project.resume();
    expect(project.id).toBe('a');
    expect(project.metadata.notes).toBe('keep');
    expect(project.updatedAt).toBeGreaterThan(paused.updatedAt);
    expect(toCatalogDoc(project).pausedAt).toBeNull();
    expect(planCatalogMerge([paused], [project.toJSON()]).storeLocal[0].status).toBe('active');
});
test('invalid lifecycle payloads cannot enter model or catalog', () => {
    expect(() => Project.fromJSON({ status: 'paused' })).toThrow(/pausedAt/);
    expect(() => Project.fromJSON({ status: 'unknown' })).toThrow();
    expect(planCatalogMerge([], [{ id: 'a', name: 'Bad', status: 'paused' }]).storeLocal).toEqual([]);
});
