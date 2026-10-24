import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { stampAttendanceWrite } from '../../modules/features/attendance/AttendanceRecordWriter.js';

// Execute the actual handler without booting app.js and all its external services.
export function loadWeeklyPositionHandler(state, stateManager = { batchSetState: run => run() }) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
    const start = source.indexOf('window.toggleWeekPosition = ');
    const end = source.indexOf('// Handlers de Tarjeta Flotante', start);
    if (start < 0 || end <= start || end - start > 4000) throw new Error('Weekly position handler boundary changed');
    const globals = {
        state, stateManager, stampAttendanceWrite, window: {},
        saveScrollPosition: jest.fn(), saveApplicationData: jest.fn(), render: jest.fn(),
        invalidateEmployeeStats: jest.fn(), buildAttendanceIndex: jest.fn(),
        componentMemo: { invalidate: jest.fn() }
    };
    vm.runInNewContext(source.slice(start, end), globals);
    return { change: globals.window.toggleWeekPosition, ...globals };
}
