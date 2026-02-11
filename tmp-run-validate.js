import { validateAllDataFiles } from './lib/schema-validator.js';

(async () => {
  try {
    const results = await validateAllDataFiles('./public/data');
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Error running validator:', err);
    process.exit(2);
  }
})();