import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectionPipeline } from '../src/livekitTranslation.js';

function fixture() {
  const emitted = [], requests = [], handlers = {};
  const socket = {
    readyState: 1, socket: {send: payload => requests.push(JSON.parse(payload))},
    on: (type,fn) => {handlers[type]=fn;}, waitForOpen: async () => {},
    convert: text => requests.push({text}), flush: () => requests.push({flush:true}),
    close: () => {socket.readyState=3;handlers.close?.({code:1000});}, ping:()=>{},
  };
  let restRequests = 0;
  const client = {textToSpeechStreaming:{connect:async()=>socket},textToSpeech:{convert:async()=>{
    restRequests++;return {audios:[Buffer.from([1,0,2,0]).toString('base64')]};
  }}};
  const pipeline = new DirectionPipeline({callId:'test',label:'a-to-b',sourceLanguage:'en',targetLanguage:'hi',voice:'simran',sarvamApiKey:'test',client,
    outputSource:{captureFrame:async frame=>emitted.push([...frame.data])},
    inputResampler:{push:frame=>[frame],close:()=>{}},
    outputResampler:{push:frame=>[frame],flush:()=>[],close:()=>{}},
  });
  pipeline.active = true;
  return {pipeline,socket,requests,emitted,handlers,get restRequests(){return restRequests;}};
}
async function tick() { await new Promise(resolve=>setImmediate(resolve)); }
const audio = {type:'audio',data:{audio:Buffer.from([1,0,2,0]).toString('base64')}};
const final = {type:'event',data:{event_type:'final'}};

test('even very short replies stream audio before completion and reuse the socket in order',async t=>{
  const f=fixture();t.after(()=>f.pipeline.stop());
  f.pipeline.queueSynthesis('हाँ');
  f.pipeline.queueSynthesis('ठीक है');
  await tick();
  assert.deepEqual(f.requests.filter(r=>r.text).map(r=>r.text),['हाँ']);
  f.handlers.message(audio);
  await tick();
  assert.equal(f.emitted.length,1,'playback begins before final event');
  assert.equal(f.pipeline.pendingSynthesis,2);
  f.handlers.message(final);
  await tick();
  assert.deepEqual(f.requests.filter(r=>r.text).map(r=>r.text),['हाँ','ठीक है']);
  f.handlers.message(audio);f.handlers.message(final);
  await f.pipeline.outputChain;
  assert.equal(f.pipeline.pendingSynthesis,0);
  assert.equal(f.pipeline.synthesizedCount,2);
  assert.equal(f.restRequests,0);
  assert.equal(f.requests.filter(r=>r.type==='config').length,1);
  assert.equal(f.pipeline.status().lastTranscriptToAudioMs>=0,true);
});

test('streaming failure before audio uses fallback once, but partial audio is never replayed',async t=>{
  const before=fixture(),after=fixture();
  t.after(async()=>{await before.pipeline.stop();await after.pipeline.stop();});
  const recovered=before.pipeline.synthesize('नमस्ते');await tick();
  before.handlers.message({type:'error',data:{message:'stream unavailable'}});
  await recovered;
  assert.equal(before.restRequests,1);
  assert.equal(before.emitted.length,1);
  const failed=after.pipeline.synthesize('नमस्ते');
  const rejected=assert.rejects(failed,/stream unavailable/);
  await tick();after.handlers.message(audio);await tick();
  after.handlers.message({type:'error',data:{message:'stream unavailable'}});
  await rejected;
  assert.equal(after.restRequests,0);
  assert.equal(after.emitted.length,1);
});

test('empty final events use fallback and late audio after stopping is ignored',async t=>{
  const f=fixture();t.after(()=>f.pipeline.stop());
  const speech=f.pipeline.synthesize('हाँ');await tick();
  f.handlers.message(final);await speech;
  assert.equal(f.restRequests,1);
  await f.pipeline.stop();
  f.handlers.message(audio);
  await tick();
  assert.equal(f.emitted.length,1);
});

test('speech input is forwarded in 40ms chunks without losing PCM remainder',async t=>{
  const f=fixture();t.after(()=>f.pipeline.stop());
  const chunks=[];
  f.pipeline.sttSocket={readyState:1,transcribe:body=>chunks.push(Buffer.from(body.audio,'base64')),close:()=>{}};
  f.pipeline.handleInputFrame({data:new Int16Array(320).fill(7)});
  assert.equal(chunks.length,0);
  f.pipeline.handleInputFrame({data:new Int16Array(400).fill(9)});
  assert.equal(chunks.length,1);
  assert.equal(chunks[0].length,1280);
  assert.equal(f.pipeline.pendingInput.length,160);
  f.pipeline.handleInputFrame({data:new Int16Array(560).fill(11)});
  assert.equal(chunks.length,2);
  assert.equal(f.pipeline.pendingInput.length,0);
  assert.equal(chunks[1].readInt16LE(0),9);
  assert.equal(chunks[1].readInt16LE(160),11);
});

test('Odia keeps the app language code while using the provider locale for speech and translation',async t=>{
  const f=fixture();t.after(()=>f.pipeline.stop());
  f.pipeline.sourceLanguage='or';f.pipeline.targetLanguage='or';
  let sttRequest,translationRequest;
  f.pipeline.client.speechToTextStreaming={connect:async request=>{
    sttRequest=request;return {on:()=>{},waitForOpen:async()=>{},close:()=>{}};
  }};
  f.pipeline.client.text={translate:async request=>{
    translationRequest=request;return {translated_text:'Hello'};
  }};
  await f.pipeline.openSttSocket();
  await f.pipeline.openTtsSocket();
  await f.pipeline.translateOnce('test','or','en');
  assert.equal(sttRequest['language-code'],'od-IN');
  assert.equal(f.requests.find(r=>r.type==='config').data.target_language_code,'od-IN');
  assert.equal(translationRequest.source_language_code,'od-IN');
  assert.equal(translationRequest.target_language_code,'en-IN');
  assert.equal(f.pipeline.targetLanguage,'or');
});
