/**
 * Light Engine Desktop - Express Server
 * Simplified server for desktop deployment (inventory-only mode)
 * 
 * This is a lightweight wrapper that connects to your Symcod device
 * No local database needed - all data syncs over network
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8091;

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    mode: 'desktop-client',
    message: 'Light Engine Desktop - Connect to your Symcod device'
  });
});

// Setup instructions
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Light Engine Desktop</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
               background: #0a0f1e; color: #e5e7eb; padding: 40px; text-align: center; }
        h1 { color: #3b82f6; margin-bottom: 10px; }
        .subtitle { color: #9ca3af; margin-bottom: 40px; }
        .options { display: flex; gap: 24px; max-width: 900px; margin: 0 auto; }
        .box { background: #111827; border: 2px solid #2d3748; border-radius: 12px; 
               padding: 32px; flex: 1; cursor: pointer; transition: all 0.3s; }
        .box:hover { border-color: #3b82f6; transform: translateY(-4px); }
        .box h2 { color: #3b82f6; margin-top: 0; }
        .box p { color: #9ca3af; line-height: 1.6; }
        .icon { font-size: 48px; margin-bottom: 16px; }
        input { padding: 12px; font-size: 16px; width: 100%; margin: 12px 0; 
                border-radius: 8px; border: 2px solid #2d3748; background: #1a2332; color: #e5e7eb; }
        button { background: linear-gradient(135deg, #3b82f6, #60a5fa); color: white; 
                 padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; 
                 cursor: pointer; margin-top: 12px; width: 100%; }
        button:hover { opacity: 0.9; }
        .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                 background: rgba(0,0,0,0.8); align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .modal-content { background: #111827; border: 2px solid #2d3748; border-radius: 12px;
                         padding: 32px; max-width: 500px; width: 90%; }
        .close { color: #9ca3af; float: right; font-size: 28px; cursor: pointer; }
        .close:hover { color: #e5e7eb; }
      </style>
    </head>
    <body>
      <h1>🌱 Light Engine Desktop</h1>
      <p class="subtitle">Choose how you want to use Light Engine</p>
      
      <div class="options">
        <div class="box" onclick="showSymcodModal()">
          <div class="icon">🔌</div>
          <h2>Connect to Symcod Device</h2>
          <p>Connect to your local Symcod controller for full grow room automation, climate control, and sensor monitoring.</p>
          <p style="color: #60a5fa; margin-top: 16px;">Best for: Active grow operations</p>
        </div>
        
        <div class="box" onclick="useCloud()">
          <div class="icon">☁️</div>
          <h2>Cloud Inventory & Sales</h2>
          <p>Access inventory management, sales tracking, and farm operations without needing a Symcod device.</p>
          <p style="color: #60a5fa; margin-top: 16px;">Best for: Office/warehouse use</p>
        </div>
      </div>

      <div id="symcodModal" class="modal">
        <div class="modal-content">
          <span class="close" onclick="closeModal()">&times;</span>
          <h2 style="color: #3b82f6; margin-top: 0;">Connect to Symcod Device</h2>
          <p style="color: #9ca3af;">Enter your Symcod device IP address</p>
          <input type="text" id="ip" placeholder="e.g., 192.168.1.100" value="localhost">
          <button onclick="connectSymcod()">Connect</button>
        </div>
      </div>

      <script>
        function showSymcodModal() {
          document.getElementById('symcodModal').classList.add('active');
        }
        function closeModal() {
          document.getElementById('symcodModal').classList.remove('active');
        }
        function connectSymcod() {
          const ip = document.getElementById('ip').value;
          window.location.href = 'http://' + ip + ':8091';
        }
        function useCloud() {
          // Connect to cloud deployment
          window.location.href = 'http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com';
        }
      </script>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log('[Desktop Server] Light Engine running on http://localhost:' + PORT);
  console.log('[Desktop Server] Mode: Desktop Client (connects to Symcod device)');
});

module.exports = app;