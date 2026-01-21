/**
 * Farm Management Routes - Minimal Test Version
 */

import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Farms API is working!' });
});

export default router;
