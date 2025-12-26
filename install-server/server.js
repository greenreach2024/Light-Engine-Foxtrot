#!/usr/bin/env node
/**
 * Light Engine Installation Server
 * Serves installation script, binaries, checksums, and public key
 * Deploy to install.greenreach.io
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import morgan from 'morgan';
import compression from 'compression';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const BINARIES_DIR = path.join(__dirname, 'binaries');
const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure directories exist
[BINARIES_DIR, LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(compression());
app.use(morgan('combined', {
  stream: fs.createWriteStream(path.join(LOGS_DIR, 'access.log'), { flags: 'a' })
}));
app.use(morgan('dev'));

// CORS for download endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    service: 'Light Engine Installation Server',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Serve installation script
app.get('/', (req, res) => {
  const installScript = path.join(__dirname, '../scripts/install.sh');
  
  if (!fs.existsSync(installScript)) {
    return res.status(404).json({ error: 'Installation script not found' });
  }
  
  res.type('text/x-shellscript');
  res.set('Content-Disposition', 'inline; filename="install.sh"');
  res.sendFile(installScript);
});

// Serve public key for license verification
app.get('/greenreach-public.pem', (req, res) => {
  const publicKey = path.join(__dirname, '../config/greenreach-public.pem');
  
  if (!fs.existsSync(publicKey)) {
    return res.status(404).json({ error: 'Public key not found' });
  }
  
  res.type('application/x-pem-file');
  res.set('Content-Disposition', 'inline; filename="greenreach-public.pem"');
  res.sendFile(publicKey);
});

// Serve desktop and mobile installers
app.get('/downloads/:filename', (req, res) => {
  const { filename } = req.params;
  
  // Security: only allow specific filename patterns
  const allowedPatterns = [
    /^Light-Engine-Setup-\d+\.\d+\.\d+\.exe$/,
    /^Light-Engine-\d+\.\d+\.\d+\.dmg$/,
    /^Light-Engine-\d+\.\d+\.\d+\.apk$/,
    /^Light-Engine-\d+\.\d+\.\d+\.ipa$/,
    /^Light-Engine-(Setup-)?[\d\.]+\.(exe|dmg|apk|ipa)\.sha256$/
  ];
  
  const isAllowed = allowedPatterns.some(pattern => pattern.test(filename));
  if (!isAllowed) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  const filePath = path.join(BINARIES_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ 
      error: 'File not found',
      filename,
      message: 'Installer has not been built yet. Run build scripts.'
    });
  }
  
  // Set appropriate content type
  const ext = path.extname(filename);
  const contentTypes = {
    '.exe': 'application/x-msdownload',
    '.dmg': 'application/x-apple-diskimage',
    '.apk': 'application/vnd.android.package-archive',
    '.ipa': 'application/octet-stream',
    '.sha256': 'text/plain'
  };
  
  const contentType = contentTypes[ext] || 'application/octet-stream';
  
  res.type(contentType);
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

// Serve binary for specific platform
app.get('/lightengine-:platform', (req, res) => {
  const { platform } = req.params;
  
  // Validate platform
  const validPlatforms = ['linux-x64', 'linux-arm64'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({ 
      error: 'Invalid platform', 
      valid: validPlatforms 
    });
  }
  
  const binaryPath = path.join(BINARIES_DIR, `lightengine-${platform}`);
  
  if (!fs.existsSync(binaryPath)) {
    return res.status(404).json({ 
      error: 'Binary not found for platform',
      platform,
      message: 'Binary has not been built yet. Run: npm run build:pkg'
    });
  }
  
  // Log download
  console.log(`[Download] Binary: ${platform} from ${req.ip}`);
  
  res.type('application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="lightengine-${platform}"`);
  res.sendFile(binaryPath);
});

// Serve checksum for binary
app.get('/lightengine-:platform.sha256', (req, res) => {
  const { platform } = req.params;
  const checksumPath = path.join(BINARIES_DIR, `lightengine-${platform}.sha256`);
  
  if (!fs.existsSync(checksumPath)) {
    // Try to generate checksum if binary exists
    const binaryPath = path.join(BINARIES_DIR, `lightengine-${platform}`);
    
    if (fs.existsSync(binaryPath)) {
      const hash = crypto.createHash('sha256');
      const fileBuffer = fs.readFileSync(binaryPath);
      hash.update(fileBuffer);
      const checksum = hash.digest('hex');
      
      // Save checksum
      fs.writeFileSync(checksumPath, `${checksum}  lightengine-${platform}\n`);
      
      console.log(`[Generated] Checksum for ${platform}: ${checksum}`);
      
      return res.type('text/plain').send(`${checksum}  lightengine-${platform}\n`);
    }
    
    return res.status(404).json({ error: 'Checksum not found and binary does not exist' });
  }
  
  res.type('text/plain');
  res.sendFile(checksumPath);
});

// List available binaries
app.get('/binaries', (req, res) => {
  try {
    const files = fs.readdirSync(BINARIES_DIR);
    const binaries = files
      .filter(f => f.startsWith('lightengine-') && !f.endsWith('.sha256'))
      .map(filename => {
        const filepath = path.join(BINARIES_DIR, filename);
        const stats = fs.statSync(filepath);
        const checksumFile = `${filename}.sha256`;
        const checksumExists = files.includes(checksumFile);
        
        let checksum = null;
        if (checksumExists) {
          const checksumContent = fs.readFileSync(
            path.join(BINARIES_DIR, checksumFile), 
            'utf-8'
          );
          checksum = checksumContent.split(' ')[0];
        }
        
        return {
          filename,
          platform: filename.replace('lightengine-', ''),
          size: stats.size,
          sizeMB: (stats.size / 1024 / 1024).toFixed(2),
          modified: stats.mtime,
          checksum,
          downloadUrl: `/lightengine-${filename.replace('lightengine-', '')}`,
          checksumUrl: `/lightengine-${filename.replace('lightengine-', '')}.sha256`
        };
      });
    
    res.json({
      ok: true,
      count: binaries.length,
      binaries
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to list binaries',
      message: error.message
    });
  }
});

// Installation statistics (for monitoring)
app.get('/stats', (req, res) => {
  try {
    const logFile = path.join(LOGS_DIR, 'access.log');
    
    if (!fs.existsSync(logFile)) {
      return res.json({
        ok: true,
        installs: 0,
        downloads: 0,
        message: 'No access logs yet'
      });
    }
    
    const logs = fs.readFileSync(logFile, 'utf-8');
    const lines = logs.split('\n');
    
    const installs = lines.filter(l => l.includes('GET / ')).length;
    const downloads = lines.filter(l => l.includes('GET /lightengine-')).length;
    
    res.json({
      ok: true,
      installs,
      downloads,
      platforms: {
        'linux-x64': lines.filter(l => l.includes('lightengine-linux-x64')).length,
        'linux-arm64': lines.filter(l => l.includes('lightengine-linux-arm64')).length
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get stats',
      message: error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'Invalid endpoint',
    endpoints: {
      '/': 'Installation script (curl -sSL https://install.greenreach.io | bash)',
      '/downloads/Light-Engine-Setup-1.0.0.exe': 'Windows desktop installer',
      '/downloads/Light-Engine-1.0.0.dmg': 'macOS desktop installer',
      '/downloads/Light-Engine-1.0.0.apk': 'Android mobile app',
      '/downloads/Light-Engine-1.0.0.ipa': 'iOS mobile app (TestFlight)',
      '/greenreach-public.pem': 'Public key for license verification',
      '/lightengine-linux-x64': 'Binary for Linux x86_64',
      '/lightengine-linux-arm64': 'Binary for Linux ARM64',
      '/lightengine-{platform}.sha256': 'SHA-256 checksum for binary',
      '/binaries': 'List all available binaries',
      '/stats': 'Installation statistics',
      '/health': 'Health check'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('======================================');
  console.log('Light Engine Installation Server');
  console.log('======================================');
  console.log(`Listening on port ${PORT}`);
  console.log(`Binaries directory: ${BINARIES_DIR}`);
  console.log(`Logs directory: ${LOGS_DIR}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET /                          - Installation script`);
  console.log(`  GET /downloads/*.exe|dmg|apk   - Desktop/mobile installers`);
  console.log(`  GET /greenreach-public.pem     - Public key`);
  console.log(`  GET /lightengine-linux-x64     - Linux x86_64 binary`);
  console.log(`  GET /lightengine-linux-arm64   - Linux ARM64 binary`);
  console.log(`  GET /binaries                  - List binaries`);
  console.log(`  GET /stats                     - Statistics`);
  console.log(`  GET /health                    - Health check`);
  console.log('======================================');
});
