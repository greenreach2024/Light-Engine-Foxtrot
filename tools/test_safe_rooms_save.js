import fs from 'fs';
(async ()=>{
  const room = { id: 'room-test-2', name: 'Test Room RS485', devices: [
    { name: 'SimDevice', vendor: 'Acme', model: 'S1', host: '192.0.2.1', setup: { wifi: { ssid: 'X', psk: 'Y' } } },
    { name: 'RS485Device', vendor: 'ModCo', model: 'M100', host: '192.0.2.2', setup: { rs485: { host: '192.0.2.2', unitId: 5, baud: '9600' } } },
    { name: 'AnalogDevice', vendor: 'AnalogInc', model: 'A10', host: '', setup: { '0-10v': { channel: 'A1', scale: '0-100' } } }
  ] };
  const payload = { rooms: [room] };
  const r = await fetch('http://127.0.0.1:8091/data/rooms.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  console.log('POST /data/rooms.json status', r.status);
  const saved = fs.readFileSync('./public/data/rooms.json','utf8');
  console.log('Saved file length', saved.length);
  process.exit(0);
})();