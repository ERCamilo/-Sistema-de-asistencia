import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';

class MemoryDB {
    constructor() { this.data = new Map(); }
    async get(_name, key) { return this.data.get(key); }
    async getAll() { return [...this.data.values()]; }
    async update(_name, value) { this.data.set(value.key, JSON.parse(JSON.stringify(value))); }
    async delete(_name, key) { this.data.delete(key); }
}
const PROJECT='PRJ-1';
function sub({ id, capturedAt, hours=8, status='present', rosterStatus='active' }) {
    return { schema:'attendance-submission/v1', submissionId:id, saProjectId:PROJECT,
        scope:{ownerUid:'o',siteId:'s',sourceId:'mini-a'}, deviceId:'MINI-A', rosterVersion:'r1',
        capturedAt, workDate:'2026-09-10', coverageMode:'linked-roster-full', rows:[{
            miniLocalId:'m1',saEmployeeId:'E1',number:'1',name:'Juan',normalHours:Math.min(hours,8),
            overtimeHours:Math.max(0,hours-8),status,rosterStatus
        }]};
}
const id=n=>`123e4567-e89b-42d3-a456-42661417400${n}`;

describe('AttendanceSubmissionInboxStore source/day version compaction',()=>{
    test('keeps only Original + Actual while latest replaces previous Actual',async()=>{
        const db=new MemoryDB(); let now=100; const store=new AttendanceSubmissionInboxStore({db,now:()=>now++});
        await store.importSubmission(sub({id:id(1),capturedAt:'2026-09-10T08:00:00.000Z',hours:8}),{expectedSaProjectId:PROJECT});
        await store.importSubmission(sub({id:id(2),capturedAt:'2026-09-10T10:00:00.000Z',hours:10}),{expectedSaProjectId:PROJECT});
        await store.importSubmission(sub({id:id(3),capturedAt:'2026-09-10T12:00:00.000Z',hours:16}),{expectedSaProjectId:PROJECT});
        const all=await store.list();
        expect(all).toHaveLength(2);
        expect(all.map(x=>x.submissionId).sort()).toEqual([id(1),id(3)].sort());
        const [group]=await store.listVersionGroups({saProjectId:PROJECT});
        expect(group.original.submissionId).toBe(id(1));
        expect(group.current.submissionId).toBe(id(3));
        expect(group.updateCount).toBe(2);
        expect(group.diff.details[0]).toMatchObject({beforeHours:8,afterHours:16,deltaHours:8});
    });
    test('older delayed capture does not replace current snapshot',async()=>{
        const db=new MemoryDB(); const store=new AttendanceSubmissionInboxStore({db,now:()=>100});
        await store.importSubmission(sub({id:id(1),capturedAt:'2026-09-10T10:00:00.000Z',hours:8}),{expectedSaProjectId:PROJECT});
        const result=await store.importSubmission(sub({id:id(2),capturedAt:'2026-09-10T09:00:00.000Z',hours:16}),{expectedSaProjectId:PROJECT});
        expect(result.outcome).toBe('stale-version');
        expect(await store.list()).toHaveLength(1);
    });
    test('summary reports activation plus attendance added',async()=>{
        const db=new MemoryDB(); const store=new AttendanceSubmissionInboxStore({db,now:()=>100});
        await store.importSubmission(sub({id:id(1),capturedAt:'2026-09-10T08:00:00.000Z',hours:0,status:'unmarked',rosterStatus:'paused'}),{expectedSaProjectId:PROJECT});
        await store.importSubmission(sub({id:id(2),capturedAt:'2026-09-10T09:00:00.000Z',hours:8,status:'present',rosterStatus:'active'}),{expectedSaProjectId:PROJECT});
        const [group]=await store.listVersionGroups();
        expect(group.diff.summary).toMatchObject({attendanceAdded:1,activated:1,totalChanges:1});
    });
});
