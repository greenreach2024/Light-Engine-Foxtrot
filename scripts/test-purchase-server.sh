#!/bin/bash
# Simple test server for purchase functionality

cd /Users/petergilbert/Light-Engine-Foxtrot

# Start a minimal server with just the purchase route
PORT=8092 node -e "
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Import purchase routes
const purchaseRouter = require('./routes/purchase');
app.use('/api/farms', purchaseRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: 8092 });
});

app.listen(8092, () => {
  console.log('✅ Test purchase server running on http://localhost:8092');
  console.log('📝 Test endpoint: POST http://localhost:8092/api/farms/create-checkout-session');
});
"
