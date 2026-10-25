import pathlib,subprocess,os,socket,time,json
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'qa/multiobra360/results/independent-review'
out.mkdir(parents=True,exist_ok=True)
jobs=[]
def run(label,args,env=None,timeout=120):
    output=out/(label+'.log')
    with output.open('w') as log:
        r=subprocess.run(args,cwd=root,env={**os.environ,**(env or {})},stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
    jobs.append({'label':label,'exitCode':r.returncode,'log':str(output)})
    print(label+' exit='+str(r.returncode),flush=True)
run('unit',['node','node_modules/jest/bin/jest.js','-c','qa/multiobra360/jest.config.cjs','--runInBand','--runTestsByPath','qa/multiobra360/tests/IndependentBoundaryReview.test.js','--json','--outputFile='+str(out/'unit.json')])
java=os.environ.get('MULTIOBRA_JAVA','/tmp/sa-firestore-emulator-jre/jdk-21.0.12.1+1-jre/bin/java')
jar=os.environ.get('FIRESTORE_EMULATOR_JAR',str(pathlib.Path.home()/'.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar'))
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
log=(out/'firestore.log').open('w')
emulator=subprocess.Popen([java,'-jar',jar,'--host','127.0.0.1','--port',str(port),'--project_id','demo-sa-multiobra-review'],stdout=log,stderr=subprocess.STDOUT)
try:
    deadline=time.monotonic()+30
    while True:
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.5):break
        except OSError:
            if emulator.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Emulator failed')
            time.sleep(.1)
    env={'FIRESTORE_EMULATOR_HOST':'127.0.0.1:'+str(port),'SA_EMULATOR_NODE_MODULES':os.environ.get('SA_EMULATOR_NODE_MODULES','/tmp/sa-firestore-emulator-jre/node_modules'),'MULTIOBRA_RESULTS':str(out),'MULTIOBRA_POINT':'REVIEW','MULTIOBRA_AUDIT_PROJECT':'demo-sa-multiobra-review-'+str(os.getpid())}
    run('emulator',['node','node_modules/jest/bin/jest.js','-c','qa/multiobra360/jest.emulator.config.cjs','--runInBand','--runTestsByPath','qa/multiobra360/tests/emulator/IndependentTransactionReview.emulator.test.js','--json','--outputFile='+str(out/'emulator.json')],env,150)
    run('browser',['node','qa/multiobra360/browser.cjs'],env,150)
finally:
    emulator.terminate()
    try:emulator.wait(timeout=5)
    except subprocess.TimeoutExpired:emulator.kill();emulator.wait(timeout=5)
    log.close()
    (out/'run.json').write_text(json.dumps(jobs,indent=2))
for label in ['unit','emulator']:
    d=json.loads((out/(label+'.json')).read_text())
    print(label,json.dumps({k:d.get(k) for k in ['success','numPassedTests','numFailedTests','numPendingTests']}),flush=True)
    for suite in d['testResults']:
        for test in suite['assertionResults']:
            if test['status']=='failed':print(test['fullName']+'\n'+'\n'.join(test['failureMessages'])[:1300],flush=True)
if (out/'browser.json').exists(): print('browser',json.dumps(json.loads((out/'browser.json').read_text())['summary']),flush=True)
raise SystemExit(1 if any(j['exitCode'] for j in jobs) else 0)
