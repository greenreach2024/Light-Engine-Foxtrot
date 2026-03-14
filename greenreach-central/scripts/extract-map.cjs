const canada = require('@svg-maps/canada').default || require('@svg-maps/canada');
const simplify = require('simplify-js');
const fs = require('fs');

const idMap = {
  ab: 'AB', bc: 'BC', mb: 'MB', nb: 'NB', nl: 'NL',
  nt: 'NT', ns: 'NS', nu: 'NU', on: 'ON', pe: 'PE',
  qc: 'QC', sk: 'SK', yt: 'YT'
};

function pathToPoints(d) {
  var subpaths = [];
  var cur = [];
  var cx = 0, cy = 0, sx = 0, sy = 0;
  var parts = d.split(/(?=[MmLlHhVvCcSsQqTtAaZz])/);
  for (var pi = 0; pi < parts.length; pi++) {
    var part = parts[pi];
    if (!part.trim()) continue;
    var cmd = part[0];
    var cs = part.slice(1).trim();
    var co = cs ? cs.split(/[\s,]+/).map(Number).filter(function(n) { return !isNaN(n); }) : [];
    if (cmd === 'M') {
      if (cur.length > 0) subpaths.push(cur);
      cur = [];
      cx = co[0]; cy = co[1]; sx = cx; sy = cy;
      cur.push({x: cx, y: cy});
      for (var i = 2; i < co.length - 1; i += 2) { cx = co[i]; cy = co[i+1]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'm') {
      if (cur.length > 0) subpaths.push(cur);
      cur = [];
      cx += co[0]; cy += co[1]; sx = cx; sy = cy;
      cur.push({x: cx, y: cy});
      for (var i = 2; i < co.length - 1; i += 2) { cx += co[i]; cy += co[i+1]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'L') {
      for (var i = 0; i < co.length - 1; i += 2) { cx = co[i]; cy = co[i+1]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'l') {
      for (var i = 0; i < co.length - 1; i += 2) { cx += co[i]; cy += co[i+1]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'H') {
      cx = co[0]; cur.push({x: cx, y: cy});
    } else if (cmd === 'h') {
      cx += co[0]; cur.push({x: cx, y: cy});
    } else if (cmd === 'V') {
      cy = co[0]; cur.push({x: cx, y: cy});
    } else if (cmd === 'v') {
      cy += co[0]; cur.push({x: cx, y: cy});
    } else if (cmd === 'z' || cmd === 'Z') {
      cx = sx; cy = sy; cur.push({x: cx, y: cy});
    } else if (cmd === 'c') {
      for (var i = 0; i < co.length - 5; i += 6) { cx += co[i+4]; cy += co[i+5]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'C') {
      for (var i = 0; i < co.length - 5; i += 6) { cx = co[i+4]; cy = co[i+5]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 's') {
      for (var i = 0; i < co.length - 3; i += 4) { cx += co[i+2]; cy += co[i+3]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'S') {
      for (var i = 0; i < co.length - 3; i += 4) { cx = co[i+2]; cy = co[i+3]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'q') {
      for (var i = 0; i < co.length - 3; i += 4) { cx += co[i+2]; cy += co[i+3]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'Q') {
      for (var i = 0; i < co.length - 3; i += 4) { cx = co[i+2]; cy = co[i+3]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'a') {
      for (var i = 0; i < co.length - 6; i += 7) { cx += co[i+5]; cy += co[i+6]; cur.push({x: cx, y: cy}); }
    } else if (cmd === 'A') {
      for (var i = 0; i < co.length - 6; i += 7) { cx = co[i+5]; cy = co[i+6]; cur.push({x: cx, y: cy}); }
    }
  }
  if (cur.length > 0) subpaths.push(cur);
  return subpaths;
}

function rn(n) {
  return parseFloat(n.toFixed(1));
}

function pointsToPath(subpaths) {
  var parts = [];
  for (var si = 0; si < subpaths.length; si++) {
    var pts = subpaths[si];
    if (pts.length < 3) continue;
    var s = pts[0];
    var p = 'M' + rn(s.x) + ',' + rn(s.y);
    var prev = s;
    var lp = [];
    for (var i = 1; i < pts.length; i++) {
      lp.push(rn(pts[i].x - prev.x) + ',' + rn(pts[i].y - prev.y));
      prev = pts[i];
    }
    if (lp.length > 0) p += 'l' + lp.join(',');
    p += 'z';
    parts.push(p);
  }
  return parts.join('');
}

var tol = { NU: 4, NT: 3, NL: 2.5, BC: 2, QC: 2, ON: 2, AB: 1.5, SK: 1, MB: 1.5, NB: 1, NS: 1, PE: 0.5, YT: 2 };
var minPts = { NU: 10, NT: 8, NL: 6, BC: 5, QC: 5, ON: 5, NS: 4, NB: 4 };
var defaultMinPts = 3;

var centroids = {
  BC: {x: 118, y: 870},
  AB: {x: 240, y: 900},
  SK: {x: 330, y: 900},
  MB: {x: 415, y: 885},
  ON: {x: 510, y: 945},
  QC: {x: 620, y: 875},
  NB: {x: 693, y: 990},
  NS: {x: 728, y: 1005},
  PE: {x: 713, y: 976},
  NL: {x: 755, y: 910},
  NT: {x: 290, y: 610},
  YT: {x: 85, y: 585},
  NU: {x: 475, y: 410}
};

var results = {};
var total = 0;

canada.locations.forEach(function(loc) {
  var id = idMap[loc.id] || loc.id.toUpperCase();
  var t = tol[id] || 1;
  var mp = minPts[id] || defaultMinPts;
  var subpaths = pathToPoints(loc.path);
  var simp = subpaths.map(function(sp) { return simplify(sp, t, true); }).filter(function(sp) { return sp.length >= mp; });
  var pathStr = pointsToPath(simp);
  results[id] = { name: loc.name, path: pathStr, centroid: centroids[id] };
  total += pathStr.length;
  console.log(id + ': ' + loc.path.length + ' -> ' + pathStr.length + ' chars (' + simp.length + ' subpaths)');
});

console.log('Total: ' + total + ' chars (' + Math.round(total / 1024) + 'KB)');
fs.writeFileSync('scripts/canada-paths.json', JSON.stringify(results, null, 2));
console.log('Wrote scripts/canada-paths.json');
