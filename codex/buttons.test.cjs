const {test}=require('node:test'),assert=require('node:assert/strict');
const {lineTestState:S}=require('./ui-model.js');
test('A fresh Wi-Fi launch is pending at zero real samples',()=>{const s=S({mode:'wifi',started:true});assert.equal(s.active,true);assert.equal(s.pending,true);assert.equal(s.samples,0);assert.equal(s.matched,false);});
test('Only the measured classification ends pending state',()=>{assert.equal(S({mode:'wifi',started:true,cls:'amont',samples:8}).pending,true);assert.equal(S({mode:'wifi',started:true,cls:'wifi',samples:8}).matched,true);});
test('Paused time is not an input to sample progress',()=>{assert.deepEqual(S({mode:'wifi',started:true,samples:3}),S({mode:'wifi',started:true,samples:3,elapsed:999}));});
test('No test progress is invented for initial, nominal, corrected or household views',()=>{for(const params of [{mode:'wifi'},{mode:'nominal',started:true},{mode:'wifiFixed',started:true},{mode:'wifi',started:true,source:'household'}])assert.equal(S(params).active,false);});
test('A missing diagnosis eventually allows an explicit retry without claiming success',()=>{assert.equal(S({mode:'wifi',started:true,samples:44}).pending,true);const s=S({mode:'wifi',started:true,samples:45});assert.equal(s.pending,false);assert.equal(s.exhausted,true);assert.equal(s.matched,false);});
test('SMS demonstration expects measured rupture rather than a nonexistent SMS classification',()=>{assert.equal(S({mode:'sms',started:true,cls:'rupture'}).matched,true);});
test('Invalid progress is safely bounded and never marks diagnosis complete',()=>{for(const samples of [NaN,Infinity,-20])assert.equal(S({mode:'wifi',started:true,samples}).samples,0);assert.equal(S({mode:'wifi',started:true,samples:1.9}).samples,1);});
