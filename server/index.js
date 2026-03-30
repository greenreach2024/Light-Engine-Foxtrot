// Import device assignment controller
import { default as switchBotDeviceController } from './controllers/switchbot-device-assignment.js';

// ... existing imports and setup ...

// Add SwitchBot device management routes
app.use('/switchbot', switchBotDeviceController);