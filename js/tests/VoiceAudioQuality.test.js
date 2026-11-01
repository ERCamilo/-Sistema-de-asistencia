import { assessVoiceAudio } from '../modules/features/voice/VoiceAudioQuality.js';
import { VoiceRecorder } from '../modules/features/voice/VoiceRecorder.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { VoiceAudioView } from '../modules/features/voice/VoiceAudioView.js';

beforeEach(() => {
    if (!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=> 'quality-capture-id'});
});

test('local levels distinguish silence/low/normal; pauses and construction noise are not rejected', () => {
    expect(assessVoiceAudio(Array(30).fill(0),2400).status).toBe('silent');
    expect(assessVoiceAudio(Array(30).fill(.004),2400).status).toBe('low');
    expect(assessVoiceAudio([...Array(80).fill(0),...Array(20).fill(.06)],8000).status).toBe('normal');
    expect(assessVoiceAudio(Array(30).fill(.2),2400).status).toBe('normal');
    expect(assessVoiceAudio([],2400).status).toBe('unmeasured');
    expect(assessVoiceAudio(Array(5).fill(0),400).status).toBe('unmeasured');
});

test.each(['silent','low'])('a %s recording keeps its audio, warns, and can still be sent explicitly', async status => {
    let options;const store={put:jest.fn().mockResolvedValue(),list:async()=>[],aliases:async()=>[],close:jest.fn()};
    const ui=new VoiceMvpUI({getUser:()=>({uid:'u'}),getScope:()=>({enabled:false}),getEmployees:()=>[],getSettings:()=>({voiceReviewBeforeSend:false})},{store,recorderFactory:opts=>{options=opts;return{start:async()=>{},cancel:jest.fn()};}});
    ui.run=callback=>callback();ui.render=jest.fn();ui.refreshMatches=async()=>{};ui.dialog={open:false,showModal:()=>{ui.dialog.open=true;}};
    ui.setCaptureState=jest.fn();ui.showWave=jest.fn();ui.process=jest.fn().mockResolvedValue();
    await ui.action('record');const audio=new Blob(['audio'],{type:'audio/mp4'});
    await options.onComplete({audio,mimeType:'audio/mp4',durationMs:2000,audioQuality:{status}});
    const id=ui.record.requestId;expect(ui.record.audio).toBe(audio);expect(ui.process).not.toHaveBeenCalled();
    const button=(action,label)=>`<button data-voice-action="${action}">${label}</button>`;
    document.body.innerHTML=VoiceAudioView({...ui,adapter:ui.adapter,record:ui.record,endpoint:()=> 'https://n8n.example/voice'},button);
    expect(document.querySelector('.voice-quality-notice').textContent).toContain(status==='silent'?'No se detectó sonido':'muy bajo');
    expect(document.querySelector('[data-voice-action=process]').textContent).toContain('Enviar de todos modos');
    ui.record.dirty=true;ui.record.draft={principal:600};ui.confirmInline=jest.fn().mockResolvedValue(false);
    await ui.action('record');expect(ui.record.requestId).toBe(id);expect(ui.record.draft.principal).toBe(600);
    await ui.action('process');expect(ui.process).toHaveBeenCalledTimes(1);expect(ui.record.requestId).toBe(id);
});

test.each(['normal','unmeasured'])('%s measurements keep the existing automatic submission', async status => {
    let options;const ui=new VoiceMvpUI({getUser:()=>({uid:'u'}),getScope:()=>({enabled:false}),getSettings:()=>({voiceReviewBeforeSend:false})},{store:{put:async()=>{},list:async()=>[]},recorderFactory:opts=>{options=opts;return{start:async()=>{}};}});
    ui.run=callback=>callback();ui.render=jest.fn();ui.refreshMatches=async()=>{};ui.setCaptureState=jest.fn();ui.showWave=jest.fn();ui.dialog={open:true};ui.process=jest.fn().mockResolvedValue();
    ui.dialog.close=()=>{ui.dialog.open=false;};ui.dialog.showModal=()=>{ui.dialog.open=true;};
    await ui.action('record');await options.onComplete({audio:new Blob(['audio']),mimeType:'audio/webm',durationMs:1500,audioQuality:{status}});
    expect(ui.process).toHaveBeenCalledTimes(1);
});

test.each(['running','suspended'])('recorder measures the existing float meter only while AudioContext is %s', async contextState => {
    jest.useFakeTimers();const original=global.AudioContext;let complete;
    const stopTrack=jest.fn();
    class Context {constructor(){this.state=contextState;}createAnalyser(){return{fftSize:256,getFloatTimeDomainData:data=>data.fill(.004)};}createMediaStreamSource(){return{connect(){}};}resume(){return Promise.resolve();}close(){return Promise.resolve();}}
    class Recorder {static isTypeSupported(type){return type==='audio/mp4';}constructor(){this.mimeType='audio/mp4';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['capture'],{type:'audio/mp4'})});this.onstop();}}
    global.AudioContext=Context;
    try {
        const recorder=new VoiceRecorder({Recorder,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:stopTrack}]})},onComplete:value=>{complete=value;}});
        await recorder.start();jest.advanceTimersByTime(1600);recorder.stop();
        expect(complete.mimeType).toBe('audio/mp4');expect(complete.audioQuality.status).toBe(contextState==='running'?'low':'unmeasured');
        expect(stopTrack).toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);
    } finally {global.AudioContext=original;jest.useRealTimers();}
});
