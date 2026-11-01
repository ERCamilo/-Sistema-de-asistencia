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
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const profileItem=(id='new-1',over={},extra={})=>({id,sources:[{miniLocalId:'local-9',sourcePeerId:'peer-1',sourcePeerName:'Mini de Juan',number:'9',name:'Pedro Nuevo',positionName:'Albañil',dailySalary:1500,workDate:'2026-10-20',capturedAt:'2026-10-20T20:00:00.000Z',...over}],...extra});
const scope={enabled:true,projectId:'P-1',defaultProjectId:'P-1'};
const withProfile=(items,deps)=>{controller=new MiniAttendanceImportModal({employees:[],positions:[],saProjectId:'P-1'});controller.multiDayResolver={getIdentityCandidates:()=>[],items};if(deps)controller.employeeIntakeDeps=deps;return controller;};
test('crear o vincular aparece solo si la asistencia trae sueldo o puesto, junto al botón actual',()=>{
 const item=profileItem();
 const rich=withProfile([item]).buildConnectedIdentityControls(item);
 expect(rich.querySelector('[data-mini-action="create-from-attendance"]')).not.toBeNull();
 expect(rich.querySelector('[data-mini-action="register-mini-employee"]')).not.toBeNull();
 const bare=profileItem('bare-1',{positionName:undefined,dailySalary:undefined});
 expect(withProfile([bare]).buildConnectedIdentityControls(bare).querySelector('[data-mini-action="create-from-attendance"]')).toBeNull();
 const noNumber=profileItem('nn',{number:'A1'});
 expect(withProfile([noNumber]).buildConnectedIdentityControls(noNumber).querySelector('[data-mini-action="create-from-attendance"]')).toBeNull();
});
test('el botón anuncia cuántos empleados nuevos del mismo Mini se revisarán juntos',()=>{
 const one=profileItem('a'),two=profileItem('b',{miniLocalId:'local-10',number:'10',name:'Otro'}),other=profileItem('c',{miniLocalId:'z',sourcePeerId:'peer-2',number:'11',name:'De otro Mini'});
 const button=withProfile([one,two,other]).buildConnectedIdentityControls(one).querySelector('[data-mini-action="create-from-attendance"]');
 expect(button.textContent).toContain('2');
});
test('el clic guarda una propuesta local con los datos del Mini y abre la revisión sin crear nada',async()=>{
 const item=profileItem();
 const stage=jest.fn(async(proposal,options)=>({id:'entry-1',peerId:options.peerId,peerName:options.peerName,payload:proposal,status:'pending',mappings:[],local:true}));
 const openReview=jest.fn();
 const modal=withProfile([item],{store:{stage},resolveScope:async()=>scope,openReview});
 modal.buildConnectedIdentityControls(item).querySelector('[data-mini-action="create-from-attendance"]').click();await flush();
 expect(stage).toHaveBeenCalledTimes(1);
 const [proposal,options]=stage.mock.calls[0];
 expect(proposal).toMatchObject({schema:'mini-roster-proposal/v1',saProjectId:'P-1',salaryPeriod:'daily',currency:'DOP'});
 expect(proposal.employees).toEqual([{miniLocalId:'local-9',number:'9',name:'Pedro Nuevo',position:'Albañil',dailySalary:1500,phone:'',email:''}]);
 expect(options).toMatchObject({peerId:'peer-1',peerName:'Mini de Juan',scope,local:true});
 expect(openReview).toHaveBeenCalledWith(expect.objectContaining({id:'entry-1',local:true}),expect.anything());
 expect(state.employees).toBe(oldEmployees);
});
test('si no se puede guardar la propuesta avisa y no abre la revisión',async()=>{
 const item=profileItem();window.showNotification=jest.fn();const openReview=jest.fn();
 const modal=withProfile([item],{store:{stage:jest.fn().mockRejectedValue(new Error('La obra cambió.'))},resolveScope:async()=>scope,openReview});
 modal.buildConnectedIdentityControls(item).querySelector('[data-mini-action="create-from-attendance"]').click();await flush();
 expect(window.showNotification).toHaveBeenCalledWith(expect.stringContaining('La obra cambió.'),'error');expect(openReview).not.toHaveBeenCalled();
});
test('una asistencia importada sin Mini conectado se vincula tras aceptar, por el id sintético',async()=>{
 controller=new MiniAttendanceImportModal({employees:[],positions:[],saProjectId:'P-1'});controller.render=jest.fn();controller.open();
 const items=[{id:'one',sources:[{miniLocalId:'local-1',sourcePeerId:null,rawDeviceId:'phone-1',deviceId:'Mini de Juan'}]},{id:'two',sources:[{miniLocalId:'local-1',sourcePeerId:null,rawDeviceId:'phone-2'}]}];
 const resolveItemIdentity=jest.fn((id,target)=>{items.find(i=>i.id===id).saEmployeeId=target;});
 controller.multiDayResolver={items,resolveItemIdentity};controller.rememberConnectedIdentity=jest.fn().mockResolvedValue(true);
 stateManager.setState({employees:[{id:'EMP-1',number:'1',name:'Ana',projectId:'P-1'}],positions:[]});
 eventBus.emit('mini-employee-intake:accepted',{peerId:'attendance:phone-1',saProjectId:'P-1',mappings:[{miniLocalId:'local-1',saEmployeeId:'EMP-1'}]});await flush();
 expect(resolveItemIdentity).toHaveBeenCalledTimes(1);expect(resolveItemIdentity).toHaveBeenCalledWith('one','EMP-1');
});
