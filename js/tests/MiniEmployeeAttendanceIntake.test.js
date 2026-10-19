import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { eventBus } from '../modules/core/Events.js';
import { state, stateManager } from '../modules/core/AppState.js';
let controller,oldEmployees,oldPositions;
beforeEach(()=>{oldEmployees=state.employees;oldPositions=state.positions;});
afterEach(()=>{controller?.close();stateManager.setState({employees:oldEmployees,positions:oldPositions});document.body.innerHTML='';delete window.openP2PRosterTransfer;delete window.showNotification;});
test('empleado desconocido ofrece registrar desde Mini sin crear ni aplicar asistencia',async()=>{
 controller=new MiniAttendanceImportModal({employees:[],positions:[],saProjectId:'P-1'});
 controller.multiDayResolver={getIdentityCandidates:()=>[]};window.openP2PRosterTransfer=jest.fn().mockResolvedValue();
 const item={id:'unknown',sources:[{miniLocalId:'local-1',sourcePeerId:'peer-1',number:'1',name:'Ana'}]};
 const controls=controller.buildConnectedIdentityControls(item);controls.querySelector('[data-mini-action="register-mini-employee"]').click();await Promise.resolve();
 expect(window.openP2PRosterTransfer).toHaveBeenCalledTimes(1);expect(state.employees).toBe(oldEmployees);
});
test('alta confirmada refresca identidad por peer e ID Mini, conserva la asistencia pendiente y se desuscribe al cerrar',async()=>{
 controller=new MiniAttendanceImportModal({employees:[],positions:[],saProjectId:'P-1'});controller.render=jest.fn();controller.open();
 const items=[{id:'one',sources:[{miniLocalId:'local-1',sourcePeerId:'peer-1'}]},{id:'two',sources:[{miniLocalId:'local-1',sourcePeerId:'other-peer'}]}];
 const resolveItemIdentity=jest.fn((id,target)=>{items.find(i=>i.id===id).saEmployeeId=target;});
 controller.multiDayResolver={items,resolveItemIdentity};controller.rememberConnectedIdentity=jest.fn().mockResolvedValue(true);
 stateManager.setState({employees:[{id:'EMP-1',number:'1',name:'Ana',projectId:'P-1'}],positions:[]});
 const event={peerId:'peer-1',saProjectId:'P-1',mappings:[{miniLocalId:'local-1',saEmployeeId:'EMP-1'}]};
 eventBus.emit('mini-employee-intake:accepted',event);await Promise.resolve();await Promise.resolve();
 expect(resolveItemIdentity).toHaveBeenCalledTimes(1);expect(resolveItemIdentity).toHaveBeenCalledWith('one','EMP-1');expect(items[1].saEmployeeId).toBeUndefined();
 controller.close();eventBus.emit('mini-employee-intake:accepted',event);expect(resolveItemIdentity).toHaveBeenCalledTimes(1);
});
