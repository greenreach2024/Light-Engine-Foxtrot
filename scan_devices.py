#!/usr/bin/env python3
"""
Standalone BLE and IoT device scanner
Scans for Bluetooth LE devices and displays results
"""

import asyncio
import sys
from datetime import datetime

# Check for bleak
try:
    from bleak import BleakScanner
    BLEAK_AVAILABLE = True
except ImportError:
    BLEAK_AVAILABLE = False
    print("  Warning: bleak not installed. Install with: pip install bleak")

# Check for kasa
try:
    from kasa import Discover
    KASA_AVAILABLE = True
except ImportError:
    KASA_AVAILABLE = False
    print("  Warning: python-kasa not installed. Install with: pip install python-kasa")


async def scan_ble_devices(duration=10.0):
    """Scan for BLE devices"""
    if not BLEAK_AVAILABLE:
        print(" BLE scanning not available - bleak not installed")
        return []
    
    print(f" Scanning for BLE devices ({duration} seconds)...")
    print("=" * 60)
    
    try:
        discovered = await BleakScanner.discover(timeout=duration, return_adv=True)
        devices = []
        
        for device_address, (device, advertisement_data) in discovered.items():
            # Skip devices without names or services
            if not device.name and not advertisement_data.service_uuids:
                continue
            
            # Extract manufacturer info
            vendor = "Unknown"
            if advertisement_data.manufacturer_data:
                company_id_map = {
                    0x0075: "Samsung",
                    0x004C: "Apple", 
                    0x0006: "Microsoft",
                    0x003D: "Google",
                    0x00E0: "LG Electronics",
                    0x0171: "Amazon",
                    0x00BC: "Xiaomi",
                    0x00B9: "Nordic Semiconductor",
                }
                for cid in advertisement_data.manufacturer_data.keys():
                    vendor = company_id_map.get(cid, f"Vendor ID {cid:#06x}")
                    break
            
            device_info = {
                'name': device.name or 'Unknown',
                'address': device_address,
                'rssi': device.rssi,
                'vendor': vendor,
                'services': [str(uuid) for uuid in advertisement_data.service_uuids] if advertisement_data.service_uuids else []
            }
            devices.append(device_info)
        
        # Sort by RSSI (signal strength) descending
        devices.sort(key=lambda d: d['rssi'], reverse=True)
        
        print(f"\n Found {len(devices)} BLE devices:\n")
        
        for idx, dev in enumerate(devices, 1):
            print(f"{idx}. {dev['name']} ({dev['vendor']})")
            print(f"   Address: {dev['address']}")
            print(f"   Signal:  {dev['rssi']} dBm")
            if dev['services']:
                print(f"   Services: {', '.join(dev['services'][:3])}")
                if len(dev['services']) > 3:
                    print(f"             ... and {len(dev['services']) - 3} more")
            print()
        
        return devices
        
    except Exception as e:
        print(f" BLE scan failed: {e}")
        return []


async def scan_kasa_devices(timeout=5):
    """Scan for Kasa devices"""
    if not KASA_AVAILABLE:
        print(" Kasa scanning not available - python-kasa not installed")
        return []
    
    print(f" Scanning for Kasa devices ({timeout} seconds)...")
    print("=" * 60)
    
    try:
        devices = await Discover.discover(timeout=timeout)
        found = []
        
        for address, device in devices.items():
            try:
                await device.update()
                device_info = {
                    'name': device.alias,
                    'model': device.model,
                    'ip': address,
                    'device_id': device.device_id,
                    'type': device.device_type.name if hasattr(device.device_type, 'name') else str(device.device_type),
                    'online': True
                }
                found.append(device_info)
            except Exception as e:
                print(f"  Could not get details for device at {address}: {e}")
                continue
        
        print(f"\n Found {len(found)} Kasa devices:\n")
        
        for idx, dev in enumerate(found, 1):
            print(f"{idx}. {dev['name']} ({dev['model']})")
            print(f"   IP:      {dev['ip']}")
            print(f"   Type:    {dev['type']}")
            print(f"   ID:      {dev['device_id']}")
            print()
        
        return found
        
    except Exception as e:
        print(f" Kasa scan failed: {e}")
        return []


async def main():
    """Main scanner function"""
    print("\n" + "=" * 60)
    print(" IoT & BLE Device Scanner")
    print(f"⏰ Started at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60 + "\n")
    
    # Run both scans concurrently
    ble_task = scan_ble_devices(10.0) if BLEAK_AVAILABLE else asyncio.sleep(0)
    kasa_task = scan_kasa_devices(5) if KASA_AVAILABLE else asyncio.sleep(0)
    
    ble_devices, kasa_devices = await asyncio.gather(ble_task, kasa_task)
    
    print("=" * 60)
    print(f" Scan complete!")
    print(f"   BLE devices:  {len(ble_devices) if isinstance(ble_devices, list) else 0}")
    print(f"   Kasa devices: {len(kasa_devices) if isinstance(kasa_devices, list) else 0}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⏹  Scan interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n\n Fatal error: {e}")
        sys.exit(1)
