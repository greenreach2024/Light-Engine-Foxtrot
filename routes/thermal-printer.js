/**
 * Thermal Printer API
 * Direct ZPL/EPL commands for Zebra/Brother thermal printers
 * Supports USB and Network printers with print queue management
 */

import express from 'express';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import net from 'net';

const router = express.Router();

// Print queue
const printQueue = [];
let queueProcessor = null;

/**
 * ZPL Label Templates
 */
const ZPL_TEMPLATES = {
  // 2" x 3" Tray Label with QR Code
  trayLabel: (code, farmName = 'Light Engine Farm') => `
^XA
^FO50,50^BQN,2,6^FDQA,${code}^FS
^FO250,80^A0N,40,40^FD${code}^FS
^FO250,140^A0N,25,25^FD${farmName}^FS
^FO250,180^A0N,20,20^FD${new Date().toLocaleDateString()}^FS
^XZ
`,

  // 2" x 1" Harvest Label with Lot Code
  harvestLabel: (lotCode, cropName, weight, unit = 'kg') => `
^XA
^FO30,20^BQN,2,4^FDQA,LOT:${lotCode}^FS
^FO180,20^A0N,35,35^FD${cropName}^FS
^FO180,70^A0N,25,25^FDLot: ${lotCode}^FS
^FO180,105^A0N,25,25^FD${weight} ${unit}^FS
^FO180,140^A0N,20,20^FD${new Date().toLocaleDateString()}^FS
^XZ
`,

  // 4" x 6" Packing Label
  packingLabel: (orderId, buyer, items, qrData) => `
^XA
^FO50,50^A0N,50,50^FDOrder: ${orderId}^FS
^FO50,120^A0N,35,35^FD${buyer}^FS
^FO50,170^GB700,2,2^FS
^FO50,190^A0N,30,30^FDItems:^FS
${items.map((item, idx) => `^FO70,${230 + idx * 40}^A0N,25,25^FD${item}^FS`).join('\n')}
^FO550,350^BQN,2,8^FDQA,${qrData}^FS
^FO50,560^A0N,20,20^FDScan for traceability^FS
^XZ
`,
};

/**
 * EPL Label Templates (for older Brother printers)
 */
const EPL_TEMPLATES = {
  trayLabel: (code, farmName = 'Light Engine Farm') => `
N
Q203,24
A50,50,0,3,1,1,N,"${code}"
A50,90,0,2,1,1,N,"${farmName}"
B150,20,0,1,2,2,80,B,"${code}"
P1
`,

  harvestLabel: (lotCode, cropName, weight, unit = 'kg') => `
N
Q203,24
A30,20,0,3,1,1,N,"${cropName}"
A30,60,0,2,1,1,N,"Lot: ${lotCode}"
A30,90,0,2,1,1,N,"${weight} ${unit}"
B150,20,0,1,2,2,60,B,"${lotCode}"
P1
`,
};

/**
 * Print to USB printer (Linux/macOS)
 * Uses lp or lpr command
 */
async function printToUSB(zplData, printerName = null) {
  return new Promise((resolve, reject) => {
    const command = printerName ? 'lp' : 'lp';
    const args = printerName ? ['-d', printerName, '-o', 'raw'] : ['-o', 'raw'];

    const proc = spawn(command, args);

    proc.stdin.write(zplData);
    proc.stdin.end();

    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        reject(new Error(`Print failed: ${errorOutput || 'Unknown error'}`));
      }
    });

    proc.on('error', (error) => {
      reject(new Error(`Print command failed: ${error.message}`));
    });
  });
}

/**
 * Print to network printer (TCP/IP)
 * Direct socket connection to printer
 */
async function printToNetwork(zplData, host, port = 9100) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let responseData = '';

    client.connect(port, host, () => {
      client.write(zplData);
      client.end();
    });

    client.on('data', (data) => {
      responseData += data.toString();
    });

    client.on('close', () => {
      resolve({ success: true, response: responseData });
    });

    client.on('error', (error) => {
      reject(new Error(`Network print failed: ${error.message}`));
    });

    // Timeout after 10 seconds
    client.setTimeout(10000, () => {
      client.destroy();
      reject(new Error('Print timeout'));
    });
  });
}

/**
 * Print queue processor
 */
function startQueueProcessor() {
  if (queueProcessor) return;

  queueProcessor = setInterval(async () => {
    if (printQueue.length === 0) return;

    const job = printQueue[0];
    if (job.status === 'processing') return;

    job.status = 'processing';
    job.startedAt = new Date();

    try {
      if (job.type === 'usb') {
        await printToUSB(job.data, job.printerName);
      } else if (job.type === 'network') {
        await printToNetwork(job.data, job.host, job.port);
      }

      job.status = 'completed';
      job.completedAt = new Date();
      job.error = null;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = new Date();
    }

    // Remove from queue after 30 seconds
    setTimeout(() => {
      const index = printQueue.indexOf(job);
      if (index > -1) printQueue.splice(index, 1);
    }, 30000);

    // Move to next job
    if (printQueue.length > 0 && printQueue[0].status !== 'pending') {
      printQueue.shift();
    }
  }, 500);
}

/**
 * Routes
 */

/**
 * Print tray label
 * POST /api/printer/print-tray
 * Body: { code, farmName, printerType, connection, printerName?, host?, port? }
 */
router.post('/print-tray', async (req, res) => {
  try {
    const {
      code,
      farmName = 'Light Engine Farm',
      printerType = 'usb',
      connection = 'usb',
      printerName,
      host,
      port = 9100,
      format = 'zpl'
    } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }

    // Generate label data
    const labelData = format === 'zpl'
      ? ZPL_TEMPLATES.trayLabel(code, farmName)
      : EPL_TEMPLATES.trayLabel(code, farmName);

    // Add to print queue
    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: connection,
      data: labelData,
      printerName,
      host,
      port,
      status: 'pending',
      createdAt: new Date(),
      metadata: { code, farmName, labelType: 'tray' }
    };

    printQueue.push(job);
    startQueueProcessor();

    res.json({
      success: true,
      jobId: job.id,
      message: 'Print job queued',
      queuePosition: printQueue.length
    });

  } catch (error) {
    console.error('Print tray error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Print harvest label
 * POST /api/printer/print-harvest
 * Body: { lotCode, cropName, weight, unit, printerType, connection, ... }
 */
router.post('/print-harvest', async (req, res) => {
  try {
    const {
      lotCode,
      cropName,
      weight,
      unit = 'kg',
      printerType = 'usb',
      connection = 'usb',
      printerName,
      host,
      port = 9100,
      format = 'zpl'
    } = req.body;

    if (!lotCode || !cropName) {
      return res.status(400).json({ error: 'lotCode and cropName are required' });
    }

    const labelData = format === 'zpl'
      ? ZPL_TEMPLATES.harvestLabel(lotCode, cropName, weight || 'N/A', unit)
      : EPL_TEMPLATES.harvestLabel(lotCode, cropName, weight || 'N/A', unit);

    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: connection,
      data: labelData,
      printerName,
      host,
      port,
      status: 'pending',
      createdAt: new Date(),
      metadata: { lotCode, cropName, weight, unit, labelType: 'harvest' }
    };

    printQueue.push(job);
    startQueueProcessor();

    res.json({
      success: true,
      jobId: job.id,
      message: 'Print job queued',
      queuePosition: printQueue.length
    });

  } catch (error) {
    console.error('Print harvest error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Print packing label
 * POST /api/printer/print-packing
 * Body: { orderId, buyer, items[], qrData, connection, ... }
 */
router.post('/print-packing', async (req, res) => {
  try {
    const {
      orderId,
      buyer,
      items = [],
      qrData,
      connection = 'usb',
      printerName,
      host,
      port = 9100
    } = req.body;

    if (!orderId || !buyer) {
      return res.status(400).json({ error: 'orderId and buyer are required' });
    }

    const labelData = ZPL_TEMPLATES.packingLabel(orderId, buyer, items, qrData || orderId);

    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: connection,
      data: labelData,
      printerName,
      host,
      port,
      status: 'pending',
      createdAt: new Date(),
      metadata: { orderId, buyer, itemCount: items.length, labelType: 'packing' }
    };

    printQueue.push(job);
    startQueueProcessor();

    res.json({
      success: true,
      jobId: job.id,
      message: 'Print job queued',
      queuePosition: printQueue.length
    });

  } catch (error) {
    console.error('Print packing error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Print raw ZPL/EPL
 * POST /api/printer/print-raw
 * Body: { data, connection, printerName?, host?, port? }
 */
router.post('/print-raw', async (req, res) => {
  try {
    const {
      data,
      connection = 'usb',
      printerName,
      host,
      port = 9100
    } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'data is required' });
    }

    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: connection,
      data,
      printerName,
      host,
      port,
      status: 'pending',
      createdAt: new Date(),
      metadata: { labelType: 'raw' }
    };

    printQueue.push(job);
    startQueueProcessor();

    res.json({
      success: true,
      jobId: job.id,
      message: 'Print job queued',
      queuePosition: printQueue.length
    });

  } catch (error) {
    console.error('Print raw error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get print queue status
 * GET /api/printer/queue
 */
router.get('/queue', (req, res) => {
  res.json({
    queue: printQueue.map(job => ({
      id: job.id,
      status: job.status,
      type: job.type,
      metadata: job.metadata,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error
    })),
    total: printQueue.length,
    pending: printQueue.filter(j => j.status === 'pending').length,
    processing: printQueue.filter(j => j.status === 'processing').length,
    completed: printQueue.filter(j => j.status === 'completed').length,
    failed: printQueue.filter(j => j.status === 'failed').length
  });
});

/**
 * Get job status
 * GET /api/printer/job/:jobId
 */
router.get('/job/:jobId', (req, res) => {
  const job = printQueue.find(j => j.id === req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    type: job.type,
    metadata: job.metadata,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error
  });
});

/**
 * Cancel job
 * DELETE /api/printer/job/:jobId
 */
router.delete('/job/:jobId', (req, res) => {
  const index = printQueue.findIndex(j => j.id === req.params.jobId);

  if (index === -1) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = printQueue[index];

  if (job.status === 'processing') {
    return res.status(400).json({ error: 'Cannot cancel job in progress' });
  }

  printQueue.splice(index, 1);

  res.json({ success: true, message: 'Job cancelled' });
});

/**
 * Clear completed jobs
 * POST /api/printer/clear
 */
router.post('/clear', (req, res) => {
  const beforeCount = printQueue.length;
  const removedJobs = printQueue.filter(j => j.status === 'completed' || j.status === 'failed');
  
  removedJobs.forEach(job => {
    const index = printQueue.indexOf(job);
    if (index > -1) printQueue.splice(index, 1);
  });

  res.json({
    success: true,
    removed: removedJobs.length,
    remaining: printQueue.length
  });
});

/**
 * Test printer connection
 * POST /api/printer/test
 * Body: { connection, printerName?, host?, port? }
 */
router.post('/test', async (req, res) => {
  try {
    const {
      connection = 'usb',
      printerName,
      host,
      port = 9100
    } = req.body;

    // Test label
    const testLabel = `
^XA
^FO50,50^A0N,50,50^FDTEST LABEL^FS
^FO50,120^A0N,30,30^FD${new Date().toLocaleString()}^FS
^FO50,170^A0N,25,25^FDPrinter Test Successful^FS
^XZ
`;

    if (connection === 'usb') {
      await printToUSB(testLabel, printerName);
      res.json({ success: true, message: 'Test label sent to USB printer' });
    } else if (connection === 'network') {
      if (!host) {
        return res.status(400).json({ error: 'host is required for network printing' });
      }
      await printToNetwork(testLabel, host, port);
      res.json({ success: true, message: `Test label sent to ${host}:${port}` });
    } else {
      res.status(400).json({ error: 'Invalid connection type' });
    }

  } catch (error) {
    console.error('Printer test error:', error);
    res.status(500).json({ error: error.message, success: false });
  }
});

/**
 * Get available USB printers (Linux/macOS)
 * GET /api/printer/list
 */
router.get('/list', async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('lpstat', ['-p', '-d']);
      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error('Failed to list printers'));
        }
      });

      proc.on('error', () => {
        resolve(''); // Return empty if lpstat not available
      });
    });

    const printers = [];
    const lines = result.split('\n');
    
    lines.forEach(line => {
      const match = line.match(/^printer ([\w-]+)/);
      if (match) {
        printers.push({
          name: match[1],
          status: line.includes('idle') ? 'idle' : 'busy'
        });
      }
    });

    res.json({ printers });

  } catch (error) {
    console.error('List printers error:', error);
    res.json({ printers: [], error: error.message });
  }
});

export { router };
