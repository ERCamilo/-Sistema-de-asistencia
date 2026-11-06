
scenario('commit0f-rapid-clicks','COMMIT0F','two real consecutive clicks must accumulate both half-hour increments',async()=>{
 const update=idb.update.bind(idb),reached=[defer(),defer()],release=[defer(),defer()],done=[defer(),defer()];let count=0;
 idb.update=async(name,value)=>{
  if(name==='projectPayrollConfigs'&&value.projectId==='A'){
   const slot=count++;
   if(slot<2){reached[slot].resolve();await release[slot].promise;const result=await update(name,value);done[slot].resolve();return result;}
  }
  return update(name,value);
 };
 try{
  await click('[data-att-action="change-base-hours"][data-value="0.5"]');await reached[0].promise;
  await click('[data-att-action="change-base-hours"][data-value="0.5"]');
  release[0].resolve();await done[0].promise;
  await reached[1].promise;release[1].resolve();await done[1].promise;
  await new Promise(requestAnimationFrame);render();
  const saved=await idb.get('projectPayrollConfigs','A');
  check(saved.dayHours[DATE]===9,'0F-C1: two +0.5h clicks must persist 8 -> 9',{saved:saved.dayHours[DATE],visible:active.getActiveDayHours(state)[DATE],count});
 }finally{release.forEach(d=>d.resolve());idb.update=update;}
});
scenario('commit0f-old-save-event','COMMIT0F','late completion event cannot override a newer durable and visible update',async()=>{
 const update=idb.update.bind(idb),reached=defer(),release=defer(),returned=defer();let first=true;
 idb.update=async(name,value)=>{
  const result=await update(name,value);
  if(name==='projectPayrollConfigs'&&value.projectId==='A'&&first){first=false;reached.resolve();await release.promise;returned.resolve();}
  return result;
 };
 try{
  await click('[data-att-action="change-base-hours"][data-value="0.5"]');await reached.promise;
  const latest={...cfg('A',10,Date.now()+1000),dayHours:{[DATE]:10}};
  await update('projectPayrollConfigs',latest);active.setActivePayrollConfig(latest);
  release.resolve();await returned.promise;await new Promise(requestAnimationFrame);render();
  const saved=await idb.get('projectPayrollConfigs','A');
  check(saved.dayHours[DATE]===10,'0F-C2 control: the newer durable record is retained',saved);
  check(active.getActiveDayHours(state)[DATE]===10,'0F-C2: an obsolete completion event must not restore old visible hours',{saved:saved.dayHours[DATE],visible:active.getActiveDayHours(state)[DATE],text:dayText()});
 }finally{release.resolve();idb.update=update;}
});
scenario('commit0f-queued-seed','COMMIT0F','a queued seed must be invalidated when the account and project dataset change',async()=>{
 await remoteSet('FOREIGN-NEW',project('FOREIGN-NEW'));
 const atomic=idb.atomicMutate.bind(idb),reached=defer(),release=defer();let first=true;
 idb.atomicMutate=async(name,id,fn)=>{
  if(name==='projectPayrollConfigs'&&id==='FOREIGN-NEW'&&first){first=false;reached.resolve();await release.promise;}
  return atomic(name,id,fn);
 };
 const pending=sync();
 try{
  await Promise.race([reached.promise,pending]);
  catalog.stopProjectCatalogLiveSync();fb.useAuditUser('commit0f-next-account');
  await idb.delete('projects','FOREIGN-NEW');await idb.update('projects',project('NEXT-ACCOUNT'));
 }finally{release.resolve();}
 try{
  await pending;
  const orphan=await idb.get('projectPayrollConfigs','FOREIGN-NEW');
  check(!orphan,'0F-C3: old-session seed must not appear in the next local dataset',orphan);
 }finally{idb.atomicMutate=atomic;}
});
