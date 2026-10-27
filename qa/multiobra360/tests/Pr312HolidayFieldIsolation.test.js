import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { createDefaultConfig } from '../../../js/modules/features/payroll/ProjectPayrollConfig.js';
import { putConfig, getConfig } from '../../../js/modules/features/payroll/ProjectPayrollConfigStore.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const DATE='2026-10-27';
let db,releases,flights;
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);const value={promise,resolve};releases.push(value);return value;};
beforeEach(async()=>{releases=[];flights=[];db=new IndexedDBService('pr312-final-fields-'+Math.random());await db.init();});
afterEach(async()=>{releases.forEach(d=>d.resolve());await Promise.allSettled(flights);db.db.close();});
const initial=()=>({...createDefaultConfig('O'),regularHoursPerDay:8,overtimeFactor:1,payPeriod:{periodStart:'2026-10-01',periodLength:21,payDay:null},holidays:[],dayHours:{[DATE]:8},updatedAt:1});

test.each([
 ['regularHoursPerDay',10],
 ['payPeriod',{periodStart:'2026-10-01',periodLength:7,payDay:null}],
 ['overtimeFactor',2]
])('PR312 stale holiday-only write must preserve a just-confirmed %s',async(field,value)=>{
 const base=initial();await db.update('projectPayrollConfigs',base);
 const update=db.update.bind(db),entered=gate(),release=gate();let first=true;
 db.update=async(name,row)=>{if(name==='projectPayrollConfigs'&&first){first=false;entered.resolve();await release.promise;}return update(name,row);};
 const settings=putConfig({...base,[field]:value},{idb:db});flights.push(settings);await entered.promise;
 // This is exactly the read/put sequence used by toggleHoliday while another
 // settings write has not yet finished. Both saves share one repository queue.
 const holidaySnapshot=await getConfig('O',{idb:db});
 const holiday=putConfig({...holidaySnapshot,holidays:[DATE],__holidaysPatch:[DATE]},{idb:db});flights.push(holiday);
 release.resolve();await Promise.all([settings,holiday]);
 const saved=await getConfig('O',{idb:db});
 expect(saved.holidays).toEqual([DATE]);
 expect(saved[field]).toEqual(value);
 expect(saved.dayHours[DATE]).toBe(8);
 expect(Object.keys(saved).filter(key=>key.startsWith('__'))).toEqual([]);
});

test('CONTROL a holiday-only write with a current snapshot preserves the confirmed settings',async()=>{
 const saved=await putConfig({...initial(),regularHoursPerDay:10},{idb:db});
 const result=await putConfig({...saved,holidays:[DATE],__holidaysPatch:[DATE]},{idb:db});
 expect(result.regularHoursPerDay).toBe(10);expect(result.holidays).toEqual([DATE]);
});

test('CONTROL a stale day-hours patch preserves newer regular hours and changes only its target day',async()=>{
 const base=initial();await putConfig({...base,regularHoursPerDay:10},{idb:db});
 const result=await putConfig({...base,__dayHoursPatch:{[DATE]:9},dayHours:{[DATE]:9}},{idb:db});
 expect(result.regularHoursPerDay).toBe(10);expect(result.dayHours[DATE]).toBe(9);
});
