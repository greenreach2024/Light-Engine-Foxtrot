// routes/ml.js (ESM)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PY_BIN = process.env.PYTHON_BIN || 'python3';

function runPy(rid, scriptPath, argsExtra = []) {
  const args = [scriptPath, '--json', ...argsExtra];
  const proc = spawn(PY_BIN, args, { stdio: ['ignore','pipe','pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  let stdout = '', stderr = '';
  proc.stdout.on('data', d => stdout += d.toString());
  proc.stderr.on('data', d => stderr += d.toString());
  return { proc, args, getStdout: ()=>stdout, getStderr: ()=>stderr };
}

function jsonLastBlock(s) {
  const m = s.match(/\{[\s\S]*\}$/m);
  return m ? m[0] : s;
}

export function mountMLRoutes(app) {
  // /api/ml/anomalies
  app.get('/api/ml/anomalies', async (req, res) => {
    const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    const scriptPath = path.join(__dirname, '..', 'scripts', 'simple-anomaly-detector.py');
    const { proc, args, getStdout, getStderr } = runPy(rid, scriptPath, [
      ...(process.env.ML_INDOOR_CSV ? ['--input', process.env.ML_INDOOR_CSV] : []),
      ...(process.env.ML_OUTDOOR_CSV ? ['--outdoor', process.env.ML_OUTDOOR_CSV] : [])
    ]);
    let responded = false;
    const done = (code, body) => { if (!responded) { responded = true; res.status(code).json(body); } };

    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} ; done(504, { ok:false, error:'Timeout' }); }, 30_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (responded) return;
      if (code !== 0) {
        const stderr = getStderr();
        if (/ModuleNotFoundError|sklearn/i.test(stderr)) {
          return done(503, { ok:false, error:'ML dependencies not installed', message:'pip3 install scikit-learn numpy pandas', stderr });
        }
        return done(500, { ok:false, error:'ScriptFailed', code, stderr });
      }
      let out = getStdout();
      try { out = JSON.parse(out); }
      catch { out = JSON.parse(jsonLastBlock(out)); }
      done(200, { ok:true, ...out, requestId: rid, timestamp: new Date().toISOString() });
    });
  });

  // /api/ml/effects
  app.get('/api/ml/effects', async (req, res) => {
    const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    const scriptPath = path.join(__dirname, '..', 'scripts', 'effects-learner.py');
    const { proc, getStdout, getStderr } = runPy(rid, scriptPath, [
      ...(process.env.ML_TIDY_CSV ? ['--input', process.env.ML_TIDY_CSV] : []),
      ...(process.env.ML_SENSORS_CSV ? ['--sensors', process.env.ML_SENSORS_CSV] : []),
      ...(process.env.ML_DEVICES_CSV ? ['--devices', process.env.ML_DEVICES_CSV] : [])
    ]);
    let responded = false;
    const done = (code, body) => { if (!responded) { responded = true; res.status(code).json(body); } };
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} ; done(504, { ok:false, error:'Timeout' }); }, 30_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (responded) return;
      if (code !== 0) return done(500, { ok:false, error:'ScriptFailed', code, stderr: getStderr() });
      let out = getStdout();
      try { out = JSON.parse(out); }
      catch { out = JSON.parse(jsonLastBlock(out)); }
      done(200, { ok:true, ...out, requestId: rid, timestamp: new Date().toISOString() });
    });
  });
}
