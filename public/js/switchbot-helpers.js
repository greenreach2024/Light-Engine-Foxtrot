// SwitchBot device control and management helpers

async function updateDeviceRoom(deviceId, roomId) {
  try {
    const response = await fetch(`/switchbot/devices/${deviceId}/room`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showToast({ title: 'Room Assignment', msg: 'Device room updated successfully', kind: 'success' });
    await refreshSwitchBotDevices();
  } catch (error) {
    console.error('Failed to update device room:', error);
    showToast({ title: 'Error', msg: 'Failed to update device room', kind: 'error' });
  }
}

async function updateDeviceZone(deviceId, zoneId) {
  try {
    const response = await fetch(`/switchbot/devices/${deviceId}/zone`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneId })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showToast({ title: 'Zone Assignment', msg: 'Device zone updated successfully', kind: 'success' });
    await refreshSwitchBotDevices();
  } catch (error) {
    console.error('Failed to update device zone:', error);
    showToast({ title: 'Error', msg: 'Failed to update device zone', kind: 'error' });
  }
}

async function controlSwitchBotDevice(deviceId, command) {
  try {
    const response = await fetch(`/switchbot/devices/${deviceId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showToast({ 
      title: 'Device Control', 
      msg: `Command ${command} sent successfully`, 
      kind: 'success',
      icon: '🔌'
    });
    await refreshSwitchBotDevices();
  } catch (error) {
    console.error('Failed to control device:', error);
    showToast({ 
      title: 'Error', 
      msg: `Failed to send command ${command}`, 
      kind: 'error',
      icon: '⚠️'
    });
  }
}

// Make functions available globally
window.updateDeviceRoom = updateDeviceRoom;
window.updateDeviceZone = updateDeviceZone;
window.controlSwitchBotDevice = controlSwitchBotDevice;