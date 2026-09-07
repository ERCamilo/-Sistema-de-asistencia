import { auth, doc, setDoc, updateDoc } from '../modules/data/firebase.js';
import { EmployeeRepository } from '../modules/services/EmployeeRepository.js';
import { PositionRepository } from '../modules/services/PositionRepository.js';
import { LeaderRepository } from '../modules/services/LeaderRepository.js';
import FirebaseService, { _testResetAuthGeneration, _testBumpAuthGenerationForTest } from 'actual/services/FirebaseService.js';
describe('DIR-U3-001 saveFullState cross-user race', () => {
  const stateA = () => ({ settings: { schemaVersion: 3, localUpdatedAt: 1000 }, employees: [{ id: 'eA1', name: 'Ada', updatedAt: Date.now() }], positions: [{ id: 'pA1', name: 'Dev', updatedAt: Date.now() }], leaders: [{ id: 'lA1', name: 'Bob', updatedAt: Date.now() }], snapshots: [] });
  beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); doc.mockClear(); setDoc.mockClear(); updateDoc.mockClear(); auth.currentUser = { uid: 'A', email: 'a@test.com' }; _testResetAuthGeneration(); FirebaseService.resetEntityUploadTrackers(); });
  afterEach(() => { jest.restoreAllMocks(); delete auth.currentUser; localStorage.clear(); });
  test('A pending saveMany then B arrives aborts mirror and does not write B', async () => {
    let resolveEmp; const empP = new Promise(r => { resolveEmp = () => r({ written: 1, saved: stateA().employees }); });
    jest.spyOn(EmployeeRepository, 'saveMany').mockImplementation(() => empP);
    jest.spyOn(PositionRepository, 'saveMany').mockImplementation(async () => ({ written: 1, saved: stateA().positions }));
    jest.spyOn(LeaderRepository, 'saveMany').mockImplementation(async () => ({ written: 1, saved: stateA().leaders }));
    const p = FirebaseService.saveFullState(stateA());
    expect(EmployeeRepository.saveMany).toHaveBeenCalledTimes(1);
    auth.currentUser = { uid: 'B', email: 'b@test.com' };
    resolveEmp(); await p;
    expect(doc.mock.calls.map(c => c[2])).not.toContain('B');
    expect(setDoc).not.toHaveBeenCalled(); expect(updateDoc).not.toHaveBeenCalled();
    expect(PositionRepository.saveMany).not.toHaveBeenCalled(); expect(LeaderRepository.saveMany).not.toHaveBeenCalled();
  });
  test('change after employees before positions aborts positions/leaders/mirror', async () => {
    let resolveEmp; const empP = new Promise(r => { resolveEmp = () => r({ written: 1, saved: stateA().employees }); });
    jest.spyOn(EmployeeRepository, 'saveMany').mockImplementation(() => empP);
    jest.spyOn(PositionRepository, 'saveMany').mockImplementation(async () => ({ written: 1, saved: stateA().positions }));
    jest.spyOn(LeaderRepository, 'saveMany').mockImplementation(async () => ({ written: 1, saved: stateA().leaders }));
    const p = FirebaseService.saveFullState(stateA());
    expect(EmployeeRepository.saveMany).toHaveBeenCalledTimes(1); expect(PositionRepository.saveMany).not.toHaveBeenCalled();
    resolveEmp(); auth.currentUser = { uid: 'B', email: 'b@test.com' }; await p;
    expect(PositionRepository.saveMany).not.toHaveBeenCalled(); expect(LeaderRepository.saveMany).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled(); expect(doc.mock.calls.map(c=>c[2])).not.toContain('B');
  });
  test('A1 stale ABA even though UID returns still aborted', async () => {
    let resolveEmp; const empP = new Promise(r => { resolveEmp = () => r({ written: 1, saved: stateA().employees }); });
    jest.spyOn(EmployeeRepository, 'saveMany').mockImplementation(() => empP);
    jest.spyOn(PositionRepository, 'saveMany').mockResolvedValue({ written: 1, saved: stateA().positions });
    jest.spyOn(LeaderRepository, 'saveMany').mockResolvedValue({ written: 1, saved: stateA().leaders });
    const p = FirebaseService.saveFullState(stateA());
    auth.currentUser = { uid: 'B', email: 'b@test.com' }; _testBumpAuthGenerationForTest('B');
    auth.currentUser = { uid: 'A', email: 'a@test.com' }; _testBumpAuthGenerationForTest('A');
    resolveEmp(); await p;
    expect(setDoc).not.toHaveBeenCalled(); expect(updateDoc).not.toHaveBeenCalled();
    expect(doc.mock.calls.map(c=>c[2])).not.toContain('B');
  });
});
