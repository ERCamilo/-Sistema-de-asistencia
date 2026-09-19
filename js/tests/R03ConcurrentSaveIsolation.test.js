import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));

const payload = () => ({ data: {
  employees: [{ id:'new-e', number:'2', name:'New' }], positions: [],
  leaders: [{ id:'new-l', number:'2', name:'New Leader' }], attendance: {},
  settings: { companyName:'Imported' }
}});

let db, original;
beforeEach(async () => {
  jest.useFakeTimers();
  localStorage.clear();
  original = JSON.parse(JSON.stringify({
    employees: state.employees, positions: state.positions, leaders: state.leaders,
    attendance: state.attendance, settings: state.settings,
    isDataLoaded: state.isDataLoaded, useIndexedDB: state.useIndexedDB
  }));
  db = new IndexedDBService('r03-concurrent-' + Math.random());
  await db.init();
  await db.update('employees', { id:'old-e', number:'1', name:'Original' });
  await db.update('leaders', { id:'old-l', number:'1', name:'Old Leader' });
  await db.update('settings', { key:'app', companyName:'Original' });
  Object.assign(state, {
    employees:[{ id:'old-e', number:'1', name:'Original' }], positions:[],
    leaders:[{ id:'old-l', number:'1', name:'Old Leader' }], attendance:{},
    settings:{ companyName:'Original' }, isDataLoaded:true, useIndexedDB:true
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  mockedIDB.saveState.mockReset();
  db.db.close();
  Object.assign(state, original);
  delete window.showConfirm;
  jest.clearAllTimers();
  jest.useRealTimers();
});
const snapshot = async () => ({
  employees: await db.getAll('employees'),
  leaders: await db.getAll('leaders'),
  settings: await db.getAll('settings')
});

test('failed FULL cannot leak provisional imported state through a concurrent normal save', async () => {
  const before = await snapshot();
  let rejectFull;
  mockedIDB.saveState.mockImplementation((s, o = {}) => {
    if (o.clearFirst) return new Promise((_, reject) => { rejectFull = reject; });
    return db.saveState(s, o);
  });

  let callback;
  window.showConfirm = opts => { callback = opts.onConfirm; };
  setImportFullText(JSON.stringify(payload()));
  confirmImportFull();
  expect(callback).toBeInstanceOf(Function);

  const fullPromise = callback();
  expect(rejectFull).toBeInstanceOf(Function);

  await saveApplicationData({ immediate:true, localOnly:true, requireLocalSuccess:true });
  rejectFull(new DOMException('Injected FULL failure', 'QuotaExceededError'));
  await fullPromise;

  const after = await snapshot();
  expect(after).toEqual(before);
});
