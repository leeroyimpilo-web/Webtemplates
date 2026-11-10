const {test}=require('node:test');
const assert=require('node:assert/strict');
const {derivePresence,detectableNetwork,shouldActivateTransfer}=require('../src/lib/presence.mjs');
const now=Date.parse('2026-11-10T12:00:00.000Z');
const base={last_seen:new Date(now-19_000).toISOString(),is_online:true,is_available:true,
  availability_mode:'available',wifi_only:true,network_type:'wifi',download_on_data:false};
test('fresh available Wi-Fi contact may start',()=>assert.equal(shouldActivateTransfer(base,now),true));
test('stale heartbeat after 40 seconds is offline',()=>assert.equal(derivePresence({...base,last_seen:new Date(now-40_001).toISOString()},now).state,'offline'));
test('Busy and Invisible never start',()=>{
  assert.equal(shouldActivateTransfer({...base,availability_mode:'busy'},now),false);
  assert.equal(shouldActivateTransfer({...base,availability_mode:'invisible'},now),false);
});
test('Wi-Fi only blocks cellular and unverified connection',()=>{
  for(const network_type of ['cellular','unknown'])assert.equal(derivePresence({...base,network_type},now).state,'waiting-wifi');
});
test('Explicit data override allows cellular',()=>assert.equal(shouldActivateTransfer({...base,network_type:'cellular',download_on_data:true},now),true));
test('Network detection refuses to guess unknown Wi-Fi',()=>{
  assert.equal(detectableNetwork(undefined),'unknown');
  assert.equal(detectableNetwork({type:'4g'}),'unknown');
  assert.equal(detectableNetwork({type:'wifi'}),'wifi');
});
