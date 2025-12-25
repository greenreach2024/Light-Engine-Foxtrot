# mDNS Discovery for Edge Devices

This feature enables automatic discovery of Light Engine edge devices on the local network using mDNS (Multicast DNS) / Bonjour.

## Features

- **Automatic Service Advertisement**: Edge devices broadcast themselves as `light-engine.local`
- **Device Discovery**: Find all Light Engine instances on the local network
- **Zero Configuration**: No manual IP address entry required
- **Cross-Platform**: Works on macOS, Linux, and Windows

## Installation

The mDNS feature requires the `bonjour-service` package:

```bash
npm install bonjour-service
```

## Usage

### For Edge Devices (Server-Side)

Edge devices automatically advertise themselves when the server starts:

```javascript
// Automatically initialized in server-foxtrot.js
// Access device at: http://light-engine.local:3000
```

### For Discovery (Client-Side)

#### Web UI

Visit `/mdns-discovery.html` to use the graphical discovery interface:

1. Click "Start Discovery" to scan the network
2. Found devices appear as cards with connection details
3. Click "Open Dashboard" to access a device
4. Click "Test Connection" to verify connectivity

#### REST API

**Start Discovery:**
```bash
curl http://localhost:3000/api/mdns/discover
```

**Get All Discovered Services:**
```bash
curl http://localhost:3000/api/mdns/services
```

**Get Specific Service:**
```bash
curl http://localhost:3000/api/mdns/services/Light%20Engine
```

**Refresh Discovery:**
```bash
curl -X POST http://localhost:3000/api/mdns/refresh
```

**Remove Service:**
```bash
curl -X DELETE http://localhost:3000/api/mdns/services/Light%20Engine
```

**Get Discovery Status:**
```bash
curl http://localhost:3000/api/mdns/status
```

### Programmatic Usage

```javascript
import { MDNSAdvertiser, MDNSBrowser } from './lib/mdns-advertiser.js';

// Advertise a service
const advertiser = new MDNSAdvertiser({
  serviceName: 'My Light Engine',
  serviceType: 'http',
  port: 3000,
  hostname: 'my-light-engine',
  txtRecord: {
    version: '1.0.0',
    deployment: 'edge'
  }
});

advertiser.start();
// Now accessible at http://my-light-engine.local:3000

// Browse for services
const browser = new MDNSBrowser({
  serviceType: 'http',
  onServiceUp: (service) => {
    console.log('Found:', service.name, service.host);
  },
  onServiceDown: (service) => {
    console.log('Lost:', service.name);
  }
});

browser.start();

// Cleanup
advertiser.destroy();
browser.destroy();
```

## API Response Format

### Service Object

```json
{
  "name": "Light Engine",
  "host": "light-engine.local",
  "port": 3000,
  "addresses": ["192.168.1.100"],
  "url": "http://light-engine.local:3000",
  "txt": {
    "version": "1.0.0",
    "deployment": "edge",
    "platform": "linux",
    "hostname": "greenhouse-edge"
  },
  "discoveredAt": "2025-12-24T10:30:00.000Z",
  "status": "online"
}
```

## Network Requirements

- All devices must be on the same local network
- Multicast DNS must be enabled (usually enabled by default)
- UDP port 5353 must be open for mDNS traffic
- Firewalls should allow mDNS/Bonjour protocol

## Platform-Specific Notes

### macOS
- mDNS (Bonjour) is built into macOS and works out of the box
- Devices appear in Finder sidebar under "Network" when browsing

### Linux
- Requires Avahi daemon: `sudo apt-get install avahi-daemon`
- Most modern distributions have this pre-installed
- Verify: `systemctl status avahi-daemon`

### Windows
- Requires Bonjour Print Services or iTunes installed
- Alternative: Install Bonjour from Apple's website
- Check: Services → "Bonjour Service" should be running

## Troubleshooting

### Device Not Found

1. **Check same network**: Ensure all devices are on the same subnet
2. **Check firewall**: Allow UDP port 5353
3. **Check mDNS service**: 
   - macOS: `dns-sd -B _http._tcp local.`
   - Linux: `avahi-browse -a`
   - Windows: Check Bonjour Service is running

### Cannot Resolve .local Domain

1. **Check DNS resolver**: 
   ```bash
   ping light-engine.local
   ```
2. **Use IP address**: Get IP from discovery API and use directly
3. **Check /etc/nsswitch.conf** (Linux): Should include `mdns4_minimal` in hosts line

### Service Not Advertising

1. **Check bonjour-service installed**: `npm list bonjour-service`
2. **Check server logs**: Look for `[mDNS]` messages
3. **Check port not in use**: `lsof -i :5353`
4. **Try manual start**:
   ```javascript
   const { MDNSAdvertiser } = require('./lib/mdns-advertiser');
   const ad = new MDNSAdvertiser({ port: 3000 });
   ad.start();
   ```

## Security Considerations

- mDNS only works on local networks (not routable over internet)
- No authentication on discovery (anyone on network can see services)
- Use HTTPS and authentication for actual API access
- Consider disabling mDNS in production cloud deployments (edge only)

## Disable mDNS

To disable mDNS advertising:

1. Set environment variable: `MDNS_ENABLED=false`
2. Or uninstall: `npm uninstall bonjour-service`

The server will still work, but won't be discoverable via mDNS.

## Resources

- [mDNS RFC 6762](https://datatracker.ietf.org/doc/html/rfc6762)
- [Bonjour Overview](https://developer.apple.com/bonjour/)
- [Avahi Documentation](https://www.avahi.org/)
- [bonjour-service npm](https://www.npmjs.com/package/bonjour-service)
