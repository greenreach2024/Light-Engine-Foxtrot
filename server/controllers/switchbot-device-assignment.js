// Device room and zone assignment endpoints
app.put('/switchbot/devices/:deviceId/room', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { roomId } = req.body;

  if (!deviceId || typeof roomId !== 'string') {
    res.status(400).json({ ok: false, error: 'Invalid request parameters' });
    return;
  }

  try {
    const device = await findSwitchBotDevice(deviceId);
    if (!device) {
      res.status(404).json({ ok: false, error: 'Device not found' });
      return;
    }

    // Update device metadata
    const meta = device.meta || {};
    meta.room = roomId || null;
    device.meta = meta;

    // Save updated device metadata
    await saveSwitchBotDeviceMeta(deviceId, meta);

    res.json({ ok: true, device });
  } catch (error) {
    console.error('[switchbot] Failed to update device room:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
}));

app.put('/switchbot/devices/:deviceId/zone', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { zoneId } = req.body;

  if (!deviceId || typeof zoneId !== 'string') {
    res.status(400).json({ ok: false, error: 'Invalid request parameters' });
    return;
  }

  try {
    const device = await findSwitchBotDevice(deviceId);
    if (!device) {
      res.status(404).json({ ok: false, error: 'Device not found' });
      return;
    }

    // Update device metadata
    const meta = device.meta || {};
    meta.zone = zoneId || null;
    device.meta = meta;

    // Save updated device metadata
    await saveSwitchBotDeviceMeta(deviceId, meta);

    res.json({ ok: true, device });
  } catch (error) {
    console.error('[switchbot] Failed to update device zone:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
}));

// Device control endpoint
app.post('/switchbot/devices/:deviceId/command', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { command } = req.body;

  if (!deviceId || !command) {
    res.status(400).json({ ok: false, error: 'Invalid request parameters' });
    return;
  }

  try {
    const response = await switchBotApiRequest(`/devices/${deviceId}/commands`, {
      method: 'POST',
      data: {
        command,
        parameter: 'default',
        commandType: 'command'
      }
    });

    res.json({ ok: true, response });
  } catch (error) {
    console.error('[switchbot] Failed to control device:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
}));