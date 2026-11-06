import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { putConfig, getConfig } from 'actual/features/payroll/ProjectPayrollConfigStore.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
test('dos formularios de feriados sobre la misma copia deben conservar ambas fechas', async () => {
 const db = new IndexedDBService('pr312-independent-20261101-'+Math.random());
 try {
  const base=await putConfig({...createDefaultConfig('O'),holidays:[]},{idb:db});
  await Promise.all([
   putConfig({...base,holidays:['2026-11-01'],__holidaysPatch:['2026-11-01']},{idb:db}),
   putConfig({...base,holidays:['2026-11-02'],__holidaysPatch:['2026-11-02']},{idb:db})
  ]);
  expect((await getConfig('O',{idb:db})).holidays.sort()).toEqual(['2026-11-01','2026-11-02']);
 } finally {db.db?.close();}
});
