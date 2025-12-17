#!/usr/bin/env node
/**
 * NeDB offline repair: read NDJSON, ignore corrupt lines,
 * apply deletes, keep last doc per _id, write a compacted .db
 *
 * Usage: node tools/repair-nedb.js data/collection.db data/collection.fixed.db
 *
 * If you used custom serialization hooks historically, add them here.
 */
const fs = require('fs');
const readline = require('readline');

const inFile  = process.argv[2];
const outFile = process.argv[3] || (inFile ? inFile.replace(/\.db$/, '') + '.fixed.db' : undefined);

if (!inFile) {
  console.error('Usage: node tools/repair-nedb.js <input.db> [output.db]');
  process.exit(1);
}

if (!outFile) {
  console.error('Unable to determine output filename.');
  process.exit(1);
}

// If you previously used afterSerialization/beforeDeserialization hooks,
// define the inverse here. Otherwise these are pass-through no-ops.
const beforeDeserialization = (s) => s;

(async () => {
  const stats = { lines: 0, good: 0, bad: 0, deleted: 0, index: 0 };
  const map = new Map(); // _id -> latest doc

  const rl = readline.createInterface({
    input: fs.createReadStream(inFile, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) {
      continue;
    }

    stats.lines++;

    let s = line;
    try {
      s = beforeDeserialization(s);
    } catch (error) {
      stats.bad++;
      continue;
    }

    let obj;
    try {
      obj = JSON.parse(s);
    } catch (error) {
      stats.bad++;
      continue;
    }

    if (obj.$$indexCreated) {
      stats.index++;
      continue;
    }

    if (obj.$$deleted === true && obj._id) {
      map.delete(obj._id);
      stats.deleted++;
      continue;
    }

    if (obj._id) {
      map.set(obj._id, obj);
      stats.good++;
    } else {
      stats.bad++;
    }
  }

  const out = fs.createWriteStream(outFile, { encoding: 'utf8', flags: 'w' });
  for (const doc of map.values()) {
    out.write(`${JSON.stringify(doc)}\n`);
  }
  out.end();

  await new Promise((resolve) => out.on('finish', resolve));

  console.log('Repair summary:', stats, '\nWrote ->', outFile);
})().catch((error) => {
  console.error('Repair failed:', error);
  process.exit(1);
});
