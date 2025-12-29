/**
 * Light Engine Desktop - Electron Main Process
 * Inventory-only mode for desktop computers (Windows/macOS)
 */

const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Configuration
const PORT = 8091;
const isDev = process.env.NODE_ENV === 'development';
const isFirstRun = !fs.existsSync(path.join(app.getPath('userData'), 'config.json'));

let mainWindow = null;
let tray = null;
let serverProcess = null;

/**
 * Create the main browser window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    show: false, // Don't show until ready
    backgroundColor: '#0a0f1e'
  });

  // Load the app
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Handle window close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Handle navigation - open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Error handling
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorDescription);
    if (errorCode === -102) { // CONNECTION_REFUSED
      showServerError();
    }
  });
}

/**
 * Create system tray icon and menu
 */
function createTray() {
  // Skip tray icon - not critical for functionality
  console.log('[Desktop] Tray icon disabled (optional feature)');
  return;
  
  const iconPath = path.join(__dirname, 'icon.png');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Light Engine',
      click: () => {
        mainWindow.show();
      }
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => {
        shell.openExternal(`http://localhost:${PORT}`);
      }
    },
    { type: 'separator' },
    {
      label: 'About',
      click: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'About Light Engine',
          message: 'Light Engine Desktop',
          detail: `Version: ${app.getVersion()}\nInventory Management for Vertical Farms\n\n© 2025 GreenReach Inc.`
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Light Engine - Vertical Farm Inventory');
  tray.setContextMenu(contextMenu);
  
  // Double-click to show window
  tray.on('double-click', () => {
    mainWindow.show();
  });
}

/**
 * Start the Express server
 */
function startServer() {
  return new Promise((resolve, reject) => {
    console.log('[Desktop] Starting server...');
    
    // Set environment variables for inventory-only mode
    process.env.PORT = PORT.toString();
    process.env.NODE_ENV = isDev ? 'development' : 'production';
    process.env.DEPLOYMENT_MODE = 'inventory-only';
    process.env.DATABASE_URL = `sqlite:${path.join(app.getPath('userData'), 'lightengine.db')}`;
    process.env.DEMO_MODE = isDev ? 'true' : 'false';
    
    try {
      // Require server directly (works in packaged app)
      const serverScript = path.join(__dirname, 'server.js');
      console.log('[Desktop] Loading server from:', serverScript);
      require(serverScript);
      
      // Server starts immediately, wait a moment then resolve
      setTimeout(() => {
        console.log('[Desktop] Server should be running on port', PORT);
        resolve();
      }, 1000);
    } catch (error) {
      console.error('[Desktop] Failed to start server:', error);
      reject(error);
    }
  });
}

/**
 * Stop the Express server
 */
function stopServer() {
  // Server runs in same process, will stop when app quits
  console.log('[Desktop] Server will stop with app...');
}

/**
 * Show server error dialog
 */
function showServerError() {
  dialog.showErrorBox(
    'Server Error',
    'Light Engine server failed to start.\n\nPlease check:\n' +
    '- Port 8091 is not in use\n' +
    '- Database is accessible\n' +
    '- Sufficient disk space\n\n' +
    'Contact support@greenreach.io for help.'
  );
}

/**
 * Show first-run welcome dialog
 */
function showFirstRunWelcome() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Welcome to Light Engine',
    message: 'Welcome to Light Engine Desktop!',
    detail: 
      'Light Engine helps you manage your vertical farm inventory.\n\n' +
      'This desktop app runs locally on your computer with a SQLite database.\n\n' +
      'Features:\n' +
      '• Inventory management\n' +
      '• Harvest scheduling\n' +
      '• Wholesale marketplace access\n' +
      '• Reporting and analytics\n\n' +
      'The app will start automatically when you log in.\n\n' +
      'To upgrade to full automation features, contact GreenReach for an edge device.',
    buttons: ['Get Started']
  });
}

// App lifecycle
app.on('ready', async () => {
  console.log('[Desktop] App starting...');
  console.log('[Desktop] User data:', app.getPath('userData'));
  
  try {
    // Start server first
    await startServer();
    
    // Create window and tray
    createWindow();
    createTray();
    
    // Show welcome on first run
    if (isFirstRun) {
      setTimeout(() => {
        showFirstRunWelcome();
        
        // Save config to mark not first run
        const configPath = path.join(app.getPath('userData'), 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({
          firstRun: false,
          installedAt: new Date().toISOString()
        }));
      }, 2000);
    }
    
    console.log('[Desktop] App ready');
    
  } catch (error) {
    console.error('[Desktop] Startup error:', error);
    dialog.showErrorBox('Startup Error', `Failed to start Light Engine:\n\n${error.message}`);
    app.quit();
  }
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Re-create window on macOS dock click
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

// Clean shutdown
app.on('before-quit', () => {
  app.isQuitting = true;
  stopServer();
});

app.on('will-quit', () => {
  stopServer();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Desktop] Uncaught exception:', error);
  dialog.showErrorBox('Application Error', error.message);
});
