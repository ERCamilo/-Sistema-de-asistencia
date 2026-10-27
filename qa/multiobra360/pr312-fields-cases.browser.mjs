
for(const [label,field,value] of [
 ['regular-hours','regularHoursPerDay',10],
 ['pay-period','payPeriod',{periodStart:'2026-10-01',periodLength:7,payDay:null}]
])scenario('pr312-holiday-'+label,'PR312FIELDS','a real holiday click preserves a concurrently confirmed '+field,async()=>{
 const HOLIDAY='2026-10-27';
 const attendance=Object.fromEntries((await idb.getAll('attendance')).map(row=>[row.key,row]));
 stateManager.setState({selectedDate:new Date('2026-10-27T12:00:00'),attendance},{silent:true});
 const controls=await import('/js/modules/ui/AttendanceUI.js');
 const container=document.createElement('section');container.id='review-holiday';
 container.innerHTML=controls.DateControls();document.querySelector('main').append(container);
 const base=await idb.get('projectPayrollConfigs','A');
 const update=idb.update.bind(idb),get=idb.get.bind(idb),entered=defer(),release=defer(),holidayRead=defer();
 let first=true,observeRead=false;
 idb.update=async(name,row)=>{
  if(name==='projectPayrollConfigs'&&row.projectId==='A'&&first){first=false;entered.resolve();await release.promise;}
  return update(name,row);
 };
 idb.get=async(name,id)=>{
  const row=await get(name,id);
  if(observeRead&&name==='projectPayrollConfigs'&&id==='A'){observeRead=false;holidayRead.resolve();}
  return row;
 };
 const settings=configs.putConfig({...base,[field]:value});
 try{
  await entered.promise;observeRead=true;
  await click('#review-holiday [data-att-action="toggle-holiday"]');
  await holidayRead.promise;
  release.resolve();await settings;
  await until(async()=>(await get('projectPayrollConfigs','A'))?.holidays?.includes(HOLIDAY),'holiday click committed');
  const saved=await get('projectPayrollConfigs','A');
  check(JSON.stringify(saved[field])===JSON.stringify(value),'PR312: holiday-only save must preserve newer '+field,{expected:value,actual:saved[field],holidays:saved.holidays});
 }finally{release.resolve();idb.update=update;idb.get=get;container.remove();}
});
