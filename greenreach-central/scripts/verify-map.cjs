const fs = require('fs');
const html = fs.readFileSync('public/id-buy-local.html', 'utf8');
console.log('ViewBox:', html.match(/viewBox="([^"]+)"/)?.[1]);
console.log('preserveAspectRatio:', html.match(/preserveAspectRatio="([^"]+)"/)?.[1]);
console.log('Province paths:', (html.match(/id="prov-/g) || []).length);
console.log('Province labels:', (html.match(/class="province-label"/g) || []).length);
console.log('Count labels:', (html.match(/class="province-count"/g) || []).length);
console.log('heatDots group:', html.includes('id="heatDots"'));
console.log('height auto:', html.includes('height: auto'));
