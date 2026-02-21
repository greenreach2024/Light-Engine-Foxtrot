/**
 * QR Code Bulk Generator API
 * Generates sequential QR codes for tray labels with pre-registration
 */

import express from 'express';
import QRCode from 'qrcode';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

/**
 * Generate sequential QR codes and pre-register in database
 * POST /api/qr-generator/generate
 * Body: { farmId, prefix, startNumber, count, format }
 */
router.post('/generate', async (req, res) => {
  try {
    const { farmId, prefix = 'FARM-TRAY', startNumber = 1, count = 100, format = 'pdf' } = req.body;

    if (!farmId) {
      return res.status(400).json({ error: 'farmId is required' });
    }

    if (count < 1 || count > 1000) {
      return res.status(400).json({ error: 'Count must be between 1 and 1000' });
    }

    const codes = [];
    const qrDataUrls = [];

    // Generate QR codes
    for (let i = 0; i < count; i++) {
      const number = startNumber + i;
      const code = `${prefix}-${String(number).padStart(4, '0')}`;
      codes.push(code);

      // Generate QR code as data URL
      const qrDataUrl = await QRCode.toDataURL(code, {
        width: 200,
        margin: 1,
        errorCorrectionLevel: 'H'
      });
      qrDataUrls.push({ code, qrDataUrl });
    }

    // Pre-register codes in database if pool available
    if (req.app.locals.pool) {
      const pool = req.app.locals.pool;
      
      try {
        // Insert into tray_codes table
        for (const code of codes) {
          await pool.query(
            `INSERT INTO tray_codes (code, farm_id, registered, created_at)
             VALUES ($1, $2, false, NOW())
             ON CONFLICT (code) DO NOTHING`,
            [code, farmId]
          );
        }
      } catch (dbError) {
        console.warn('Database pre-registration failed (table may not exist):', dbError.message);
        // Continue even if DB insert fails - QR codes can still be generated
      }
    }

    if (format === 'json') {
      return res.json({ codes, qrDataUrls });
    }

    // Generate PDF with 4x6 grid (24 QR codes per page)
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612; // 8.5 inches
    const pageHeight = 792; // 11 inches
    const cols = 4;
    const rows = 6;
    const cellWidth = pageWidth / cols;
    const cellHeight = pageHeight / rows;
    const qrSize = 100;
    const padding = 20;

    let currentPage = null;
    let pageItemCount = 0;

    for (let i = 0; i < qrDataUrls.length; i++) {
      // Create new page every 24 items
      if (i % (cols * rows) === 0) {
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        pageItemCount = 0;
      }

      const { code, qrDataUrl } = qrDataUrls[i];
      const col = pageItemCount % cols;
      const row = Math.floor(pageItemCount / cols);

      const x = col * cellWidth + (cellWidth - qrSize) / 2;
      const y = pageHeight - (row * cellHeight + (cellHeight - qrSize) / 2 + qrSize);

      // Embed QR code image
      const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      const qrImage = await pdfDoc.embedPng(qrImageBytes);

      currentPage.drawImage(qrImage, {
        x,
        y,
        width: qrSize,
        height: qrSize
      });

      // Draw code text below QR
      const textWidth = font.widthOfTextAtSize(code, 10);
      currentPage.drawText(code, {
        x: col * cellWidth + (cellWidth - textWidth) / 2,
        y: y - 15,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0)
      });

      pageItemCount++;
    }

    // Add footer with generation info
    const pages = pdfDoc.getPages();
    pages.forEach((page, index) => {
      const footerText = `Generated: ${new Date().toLocaleDateString()} | Farm: ${farmId} | Page ${index + 1}/${pages.length}`;
      const footerWidth = font.widthOfTextAtSize(footerText, 8);
      page.drawText(footerText, {
        x: (pageWidth - footerWidth) / 2,
        y: 20,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5)
      });
    });

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tray-qr-codes-${farmId}-${Date.now()}.pdf"`);
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get available code ranges (next available numbers)
 * GET /api/qr-generator/available-range?farmId=xxx&prefix=FARM-TRAY
 */
router.get('/available-range', async (req, res) => {
  try {
    const { farmId, prefix = 'FARM-TRAY' } = req.query;

    if (!farmId) {
      return res.status(400).json({ error: 'farmId is required' });
    }

    // Try to get max number from database
    if (req.app.locals.pool) {
      try {
        const result = await req.app.locals.pool.query(
          `SELECT code FROM tray_codes 
           WHERE farm_id = $1 AND code LIKE $2
           ORDER BY code DESC LIMIT 1`,
          [farmId, `${prefix}%`]
        );

        if (result.rows.length > 0) {
          const lastCode = result.rows[0].code;
          const match = lastCode.match(/-(\d+)$/);
          if (match) {
            const lastNumber = parseInt(match[1], 10);
            return res.json({
              prefix,
              lastNumber,
              suggestedStart: lastNumber + 1,
              suggestedRange: `${prefix}-${String(lastNumber + 1).padStart(4, '0')} to ${prefix}-${String(lastNumber + 100).padStart(4, '0')}`
            });
          }
        }
      } catch (dbError) {
        console.warn('Database query failed:', dbError.message);
      }
    }

    // Default if no database or no records
    res.json({
      prefix,
      lastNumber: 0,
      suggestedStart: 1,
      suggestedRange: `${prefix}-0001 to ${prefix}-0100`
    });

  } catch (error) {
    console.error('Available range error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Validate if codes are already in use
 * POST /api/qr-generator/validate
 * Body: { codes: ['FARM-TRAY-0001', ...] }
 */
router.post('/validate', async (req, res) => {
  try {
    const { codes } = req.body;

    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: 'codes array is required' });
    }

    const conflicts = [];

    if (req.app.locals.pool) {
      try {
        const result = await req.app.locals.pool.query(
          `SELECT code FROM tray_codes WHERE code = ANY($1)`,
          [codes]
        );
        conflicts.push(...result.rows.map(r => r.code));
      } catch (dbError) {
        console.warn('Database validation failed:', dbError.message);
      }
    }

    res.json({
      valid: conflicts.length === 0,
      conflicts,
      available: codes.length - conflicts.length,
      total: codes.length
    });

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate batch group label PDF
 * POST /api/qr-generator/generate-groups
 * Body: { groupIds?: string[] }  — optional filter; omit for all groups
 *
 * Each label shows: QR code encoding "GRP:{groupId}" + group name below.
 * Layout: 3x4 grid (12 per page) for larger 2"x3" labels.
 */
router.post('/generate-groups', async (req, res) => {
  try {
    const { groupIds } = req.body || {};

    // Load groups from groups.json
    const groupsPath = join(__dirname, '..', 'public', 'data', 'groups.json');
    let groupsData;
    try {
      groupsData = JSON.parse(readFileSync(groupsPath, 'utf8'));
    } catch (readErr) {
      return res.status(500).json({ error: 'Could not read groups.json', details: readErr.message });
    }

    // Build list of groups to print
    // groups.json stores { groups: [ { id, name, ... }, ... ] }
    const groupsArray = Array.isArray(groupsData) ? groupsData
      : Array.isArray(groupsData.groups) ? groupsData.groups : [];

    let filtered = groupsArray;
    if (Array.isArray(groupIds) && groupIds.length > 0) {
      filtered = groupsArray.filter(g => groupIds.includes(g.id));
    }

    if (filtered.length === 0) {
      return res.status(400).json({ error: 'No matching groups found' });
    }

    // Generate QR data URLs for each group
    const labels = [];
    for (const groupObj of filtered) {
      const groupId = groupObj.id;
      const groupName = groupObj.name || groupId.split(':').pop() || groupId;
      const qrValue = `GRP:${groupId}`;
      const qrDataUrl = await QRCode.toDataURL(qrValue, {
        width: 250,
        margin: 1,
        errorCorrectionLevel: 'H'
      });
      labels.push({ groupId, groupName, qrDataUrl });
    }

    // Build PDF — 3 columns x 4 rows = 12 per page (larger labels for groups)
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612;   // 8.5"
    const pageHeight = 792;  // 11"
    const cols = 3;
    const rows = 4;
    const perPage = cols * rows;
    const cellWidth = pageWidth / cols;
    const cellHeight = pageHeight / rows;
    const qrSize = 120;

    let currentPage = null;
    let pageIdx = 0;

    for (let i = 0; i < labels.length; i++) {
      if (i % perPage === 0) {
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        pageIdx = 0;
      }

      const { groupId, groupName, qrDataUrl } = labels[i];
      const col = pageIdx % cols;
      const row = Math.floor(pageIdx / cols);

      const cellX = col * cellWidth;
      const cellY = pageHeight - (row + 1) * cellHeight;

      // Center QR in cell
      const qrX = cellX + (cellWidth - qrSize) / 2;
      const qrY = cellY + cellHeight - qrSize - 15;

      // Embed QR image
      const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      const qrImage = await pdfDoc.embedPng(qrImageBytes);
      currentPage.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

      // Group name below QR — truncate if too long
      const displayName = groupName.length > 28 ? groupName.slice(0, 26) + '…' : groupName;
      const nameSize = 11;
      const nameWidth = boldFont.widthOfTextAtSize(displayName, nameSize);
      currentPage.drawText(displayName, {
        x: cellX + (cellWidth - nameWidth) / 2,
        y: qrY - 14,
        size: nameSize,
        font: boldFont,
        color: rgb(0, 0, 0)
      });

      // Group ID in smaller font (useful for debugging)
      const idDisplay = groupId.length > 34 ? groupId.slice(0, 32) + '…' : groupId;
      const idSize = 7;
      const idWidth = font.widthOfTextAtSize(idDisplay, idSize);
      currentPage.drawText(idDisplay, {
        x: cellX + (cellWidth - idWidth) / 2,
        y: qrY - 26,
        size: idSize,
        font,
        color: rgb(0.4, 0.4, 0.4)
      });

      pageIdx++;
    }

    // Footer on each page
    const pages = pdfDoc.getPages();
    pages.forEach((page, idx) => {
      const footerText = `Group Labels | Generated: ${new Date().toLocaleDateString()} | Page ${idx + 1}/${pages.length}`;
      const footerWidth = font.widthOfTextAtSize(footerText, 8);
      page.drawText(footerText, {
        x: (pageWidth - footerWidth) / 2,
        y: 15,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5)
      });
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="group-labels-${Date.now()}.pdf"`);
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('[qr-generator] Group label generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

export { router };
