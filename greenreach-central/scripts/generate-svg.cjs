// Generate SVG HTML from simplified Canada paths
var data = require('./canada-paths.json');
var fs = require('fs');

var provinces = ['YT','NT','NU','BC','AB','SK','MB','ON','QC','NB','NS','PE','NL'];
var southern = ['BC','AB','SK','MB','ON','QC','NB','NS','PE','NL'];

// Adjusted label positions (manually tuned for readability)
var labels = {
  BC:  { x: 100, y: 875, size: '11px' },
  AB:  { x: 238, y: 910, size: '11px' },
  SK:  { x: 325, y: 910, size: '11px' },
  MB:  { x: 415, y: 900, size: '11px' },
  ON:  { x: 485, y: 960, size: '11px' },
  QC:  { x: 615, y: 880, size: '11px' },
  NB:  { x: 692, y: 990, size: '10px' },
  NS:  { x: 725, y: 1010, size: '10px' },
  PE:  { x: 718, y: 972, size: '8px' },
  NL:  { x: 755, y: 905, size: '10px' },
  NT:  { x: 275, y: 620, size: '10px' },
  YT:  { x: 80, y: 590, size: '10px' },
  NU:  { x: 455, y: 480, size: '10px' }
};

var lines = [];
lines.push('        <svg viewBox="-100 150 993 882" id="canadaMap" preserveAspectRatio="xMidYMid meet">');
lines.push('          <defs>');
lines.push('            <linearGradient id="mapBg" x1="0%" y1="0%" x2="100%" y2="100%">');
lines.push('              <stop offset="0%" style="stop-color:#f0f4e8;stop-opacity:1" />');
lines.push('              <stop offset="100%" style="stop-color:#e8f0dc;stop-opacity:1" />');
lines.push('            </linearGradient>');
lines.push('          </defs>');
lines.push('          <rect x="-100" y="150" width="993" height="882" fill="url(#mapBg)" rx="0"/>');
lines.push('');
lines.push('          <!-- Province shapes (geographically accurate) -->');

provinces.forEach(function(id) {
  var p = data[id];
  var fill = southern.indexOf(id) >= 0 ? '#d4e6c3' : '#e4ecd8';
  lines.push('          <path id="prov-' + id + '" d="' + p.path + '" fill="' + fill + '" stroke="#b8d4a0" stroke-width="1" data-province="' + id + '"/>');
});

lines.push('');
lines.push('          <!-- Province labels -->');
provinces.forEach(function(id) {
  var lab = labels[id];
  var style = lab.size !== '11px' ? ' style="font-size:' + lab.size + '"' : '';
  lines.push('          <text x="' + lab.x + '" y="' + lab.y + '" class="province-label"' + style + '>' + id + '</text>');
});

lines.push('');
lines.push('          <!-- Province supporter counts -->');
provinces.forEach(function(id) {
  var lab = labels[id];
  var countY = lab.y + 15;
  var style = '';
  if (lab.size === '8px') style = ' style="font-size:7px"';
  else if (lab.size === '10px') style = ' style="font-size:9px"';
  lines.push('          <text x="' + lab.x + '" y="' + countY + '" class="province-count" id="count-' + id + '"' + style + '>0</text>');
});

lines.push('');
lines.push('          <!-- Heatmap dots will be injected here -->');
lines.push('          <g id="heatDots"></g>');
lines.push('        </svg>');

var output = lines.join('\n');
console.log(output);
console.log('\n\n=== JS PROVINCE CENTERS ===');
console.log('    const provinceCenters = {');
provinces.forEach(function(id) {
  var lab = labels[id];
  console.log("      '" + id + "': { x: " + lab.x + ", y: " + (lab.y - 10) + " },");
});
console.log('    };');

fs.writeFileSync('scripts/svg-output.html', output);
console.log('\nWrote scripts/svg-output.html');
