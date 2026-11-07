import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import * as repair from '../modules/features/projects/ProjectOwnershipRepairService.js';
import {
  openProjectReconciliation, closeProjectReconciliation, registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';

const project = { id: 'PRJ-outcome', name: 'Obra principal', status: 'active' };
const orphan = id => ({ id, number: id, name: 'Empleado ' + id, active: true, positions: [], loans: [], projectId: 'missing-project' });
const action = key => document.querySelector('[data-r07-action="' + key + '"]')?.click();
const change = (selector, value) => {
  const element = document.querySelector(selector);
  if (element.type === 'radio') element.checked = true;
  else element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
};
const settle = async () => {
  for (let i = 0; i < 15; i++) await new Promise(resolve => setTimeout(resolve, 0));
};
const prepare = async () => {
  await openProjectReconciliation();
  change('[name="r07-recon-action"][value="map"]');
  change('[data-r07-control="target-project"]', project.id);
  action('quick-assign');
  expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
};
describe('Multiobra reconciliation outcome #351', () => {
  let setup, apply, read;
  beforeEach(() => {
    document.body.innerHTML = '';
    setProjectsEnabled(true);
    read = jest.spyOn(indexedDBService, 'getAll').mockResolvedValue([]);
    setup = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
      enabled: true, ready: true, activeProjectId: project.id, defaultProjectId: project.id, projects: [project]
    });
    state.employees = [orphan('1')];
    state.positions = []; state.leaders = []; state.attendance = {};
    apply = jest.spyOn(repair, 'applyOwnershipRepair').mockImplementation(async () => {
      state.employees[0].projectId = project.id;
      return { status: repair.REPAIR_STATUS.OK, cloudQueued: false };
    });
    registerProjectReconciliationGlobals();
  });
  afterEach(() => {
    closeProjectReconciliation();
    read.mockRestore(); setup.mockRestore(); apply.mockRestore();
    document.body.innerHTML = '';
  });

  test('A01: successful repair preserves a visible completed result until explicit exit', async () => {
    await prepare();
    action('apply');
    await settle();
    const result = document.querySelector('[data-r07-result]');
    expect(result).not.toBeNull();
    expect(result.textContent).toMatch(/Completado/i);
    expect(result.textContent).toMatch(/sincronizaci[oó]n.*pendiente/i);
    expect(document.querySelector('[data-r07-action="result-exit"]')).not.toBeNull();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('A02: a partial repair offers continue and exit instead of returning silently to step zero', async () => {
    state.employees.push(orphan('2'));
    apply.mockImplementation(async () => {
      state.employees[0].projectId = project.id;
      return { status: repair.REPAIR_STATUS.OK, cloudQueued: true };
    });
    await prepare();
    action('apply');
    await settle();
    const result = document.querySelector('[data-r07-result]');
    expect(result).not.toBeNull();
    expect(result.textContent).toMatch(/pendientes/i);
    expect(document.querySelector('[data-r07-action="result-continue"]')).not.toBeNull();
    action('result-continue');
    expect(document.querySelector('[data-r07-result]')).toBeNull();
    expect(document.querySelector('[data-r07-step="0"]:not([hidden])')).not.toBeNull();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('A03: failed repair presents a persistent error result with no false success', async () => {
    apply.mockResolvedValue({ status: 'FAILED', error: 'No se pudo persistir' });
    await prepare();
    action('apply');
    await settle();
    const result = document.querySelector('[data-r07-result]');
    expect(result).not.toBeNull();
    expect(result.textContent).toMatch(/fall[oó]|error/i);
    expect(document.querySelector('[data-r07-action="result-continue"]')).not.toBeNull();
    expect(state.employees[0].projectId).toBe('missing-project');
  });
});
