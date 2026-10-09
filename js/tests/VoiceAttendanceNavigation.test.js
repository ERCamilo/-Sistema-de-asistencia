import { openVoiceAttendanceEmployee } from '../modules/features/voice/VoiceAttendanceNavigation.js';

function setup(listed = true) {
    const state = { employees: [{id:'employee-1'}], activeTab:'loans', viewMode:'week', showEmployeeProfile:true, selectedDate:'2026-10-09', filters:{search:'otro',position:'position-2',leaderId:'leader-2'}, employeeFilter:'present', attendance:{existing:{present:true}} };
    let pending;
    const row = {scrollIntoView:jest.fn()};
    const deps = {state,stateManager:{batchSetState:fn=>fn()},render:jest.fn(),isAllowed:jest.fn(()=>true),isListed:()=>listed,openDetail:jest.fn(),schedule:fn=>{pending=fn;},document:{getElementById:jest.fn(()=>row)},notify:jest.fn()};
    return {state,deps,row,flush:()=>pending?.()};
}
test('voice search opens the existing attendance detail, locates the card, and never writes attendance',()=>{
    const {state,deps,row,flush}=setup(); const attendance=JSON.stringify(state.attendance);
    expect(openVoiceAttendanceEmployee('employee-1',deps)).toBe(true);
    expect(state.activeTab).toBe('attendance'); expect(state.viewMode).toBe('day');
    expect(state.showEmployeeProfile).toBe(false); expect(state.selectedDate).toBe('2026-10-09');
    expect(deps.openDetail).toHaveBeenCalledWith('employee-1');
    expect(row.scrollIntoView).not.toHaveBeenCalled(); flush();
    expect(row.scrollIntoView).toHaveBeenCalledWith({block:'center',behavior:'smooth'});
    expect(JSON.stringify(state.attendance)).toBe(attendance);
    expect(state.filters.search).toBe('otro');
});
test('hidden employee clears only list filters, and unavailable date opens detail with an honest notice',()=>{
    const {state,deps,flush}=setup(false); deps.document.getElementById.mockReturnValue(null);
    openVoiceAttendanceEmployee('employee-1',deps); flush();
    expect(state.filters).toEqual({search:'',position:'all',leaderId:'all'}); expect(state.employeeFilter).toBeNull();
    expect(deps.openDetail).toHaveBeenCalledWith('employee-1'); expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('fecha'), 'info');
});
test('another project cannot open a card, and account changes cannot scroll stale employee data',()=>{
    const {state,deps,row,flush}=setup(); deps.isAllowed.mockReturnValue(false);
    expect(openVoiceAttendanceEmployee('employee-1',deps)).toBe(false); expect(state.activeTab).toBe('loans'); expect(deps.openDetail).not.toHaveBeenCalled();
    deps.isAllowed.mockReturnValue(true); openVoiceAttendanceEmployee('employee-1',deps);
    deps.isAllowed.mockReturnValue(false); flush(); expect(row.scrollIntoView).not.toHaveBeenCalled();
});
