/** Navigate to the existing attendance card without recording attendance. */
export function openVoiceAttendanceEmployee(employeeId, { state, stateManager, render, isAllowed, isListed, openDetail, schedule = requestAnimationFrame, document: doc = document, reducedMotion = false, notify = () => {} }) {
    const employee = state.employees.find(item => item.id === employeeId);
    if (!employee || !isAllowed(employee)) return false;
    stateManager.batchSetState(() => {
        state.activeTab = 'attendance';
        state.viewMode = 'day';
        state.showEmployeeProfile = false;
        if (!isListed(employee)) {
            state.filters.search = '';
            state.filters.position = 'all';
            state.filters.leaderId = 'all';
            state.employeeFilter = null;
        }
    });
    render();
    openDetail(employeeId);
    schedule(() => {
        if (!isAllowed(employee) || state.activeTab !== 'attendance') return;
        const row = doc.getElementById(`emp-row-${employeeId}`);
        if (row) row.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
        else notify('El empleado no aparece en la fecha de asistencia seleccionada.', 'info');
    });
    return true;
}
