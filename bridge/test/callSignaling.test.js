import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

// These credentials are local fixtures; no LiveKit/Sarvam requests are made.
process.env.LIVEKIT_URL = 'wss://livekit.example.invalid';
process.env.LIVEKIT_API_KEY = 'test-api-key';
process.env.LIVEKIT_API_SECRET = 'test-livekit-secret-at-least-32-characters';
process.env.SARVAM_API_KEY = '';
process.env.WEB_PUBSUB_CONNECTION_STRING = '';
process.env.BRIDGE_PUBLIC_URL = '';
process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = '';
const { startBridge, MemoryStore } = await import('../src/server.js');

test('Android realtime-token flow delivers calls, accept/end updates and reconnect recovery without PubSub', async t => {
  const store = new MemoryStore();
  const instance = await startBridge({port:0,dataStore:store});
  t.after(async () => {
    for (const socket of instance.wss.clients) socket.terminate();
    instance.wss.close();
    await new Promise(resolve => instance.server.close(resolve));
  });
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  async function request(path,user,body,headers={}) {
    const response = await fetch(base+path,{method:body?'POST':'GET',headers:{
      'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user.token}`} : {}),...headers,
    },...(body?{body:JSON.stringify(body)}:{})});
    return {...await response.json(),httpStatus:response.status};
  }
  const users = [];
  for (const name of ['caller','receiver','outsider']) {
    users.push(await request('/api/auth/register',null,{email:`${name}@test.local`,password:'test-password'}));
  }
  const [a,b,c] = users;
  assert.equal((await request('/api/realtime-token',null,{})).httpStatus,401);
  async function connect(user) {
    const access = await request('/api/realtime-token',user,{});
    assert.equal(access.httpStatus,200);
    assert.equal(access.transport,'websocket');
    const url = new URL(access.url);
    assert.equal(url.pathname,'/ws/calls');
    const claims = jwt.decode(url.searchParams.get('token'));
    assert.equal(claims.sub,user.profile.uid);
    assert.equal(claims.aud,'vaani-setu-realtime');
    assert.equal(claims.exp-claims.iat,3600);
    assert.equal((await request('/api/calls',{token:url.searchParams.get('token')})).httpStatus,401);
    const socket = new WebSocket(access.url);
    const events = [];
    socket.on('message',data=>events.push(JSON.parse(data)));
    await once(socket,'open');
    async function waitFor(predicate) {
      for(let i=0;i<150;i++) {
        const event=events.find(predicate);
        if(event)return event;
        await delay(20);
      }
      assert.fail('Expected realtime event not received');
    }
    await waitFor(event=>event.type==='ready');
    return {socket,events,waitFor};
  }
  const secure = await request('/api/realtime-token',b,{}, {'x-forwarded-proto':'https'});
  assert.equal(new URL(secure.url).protocol,'wss:');
  const caller = await connect(a), receiver = await connect(b), outsider = await connect(c);
  const created = await request('/api/calls',a,{targetSuffix:b.profile.suffix});
  assert.equal(created.httpStatus,200);
  const invite = await receiver.waitFor(e=>e.type==='incoming_call'&&e.callId===created.callId);
  assert.equal(invite.calleeUid,b.profile.uid);
  assert.equal(invite.callerNumber,a.profile.number);
  assert.equal(outsider.events.some(e=>e.callId===created.callId),false);
  assert.equal((await request(`/api/calls/${created.callId}/accept`,c,{})).httpStatus,403);
  assert.equal((await request(`/api/calls/${created.callId}/accept`,a,{})).httpStatus,403);
  const accepted = await request(`/api/calls/${created.callId}/accept`,b,{});
  assert.equal(accepted.httpStatus,200);
  assert.equal(accepted.livekit.identity,b.profile.uid);
  const grant = jwt.verify(accepted.livekit.token,process.env.LIVEKIT_API_SECRET);
  assert.equal(grant.video.room,created.callId);
  await caller.waitFor(e=>e.callId===created.callId&&e.status==='accepted');
  await request(`/api/calls/${created.callId}/end`,a,{reason:'ended'});
  await receiver.waitFor(e=>e.callId===created.callId&&e.status==='ended');

  receiver.socket.close();
  await once(receiver.socket,'close');
  const pending = await request('/api/calls',a,{targetSuffix:b.profile.suffix});
  await store.createCall({callId:'expired-invitation',callerUid:a.profile.uid,calleeUid:b.profile.uid,status:'ringing',expiresAt:'2020-01-01T00:00:00Z'});
  const reconnected = await connect(b);
  await reconnected.waitFor(e=>e.type==='incoming_call'&&e.callId===pending.callId);
  assert.equal(reconnected.events.some(e=>e.callId===created.callId||e.callId==='expired-invitation'),false);
  assert.equal(outsider.events.some(e=>e.callId===pending.callId),false);
  const rejected = new WebSocket(`${base.replace('http','ws')}/ws/calls?token=invalid`);
  assert.equal((await once(rejected,'close'))[0],1008);
});
