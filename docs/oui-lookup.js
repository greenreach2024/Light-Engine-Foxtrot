// Minimal OUI vendor lookup for MAC addresses (first 6 hex digits)
// Example: OUILookup.getVendor('A4:C1:38:12:34:56') => 'Espressif Inc.'
const OUI_VENDOR_TABLE = {
  'A4C138': 'Espressif Inc.',
  'B827EB': 'Raspberry Pi Foundation',
  '001A11': 'Cisco Systems',
  'F4F5E8': 'SwitchBot',
  'D8A01D': 'TP-Link',
  // Add more as needed
};

export function lookupVendorByMac(mac) {
  if (!mac || typeof mac !== 'string') return 'Unknown';
  const norm = mac.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  if (norm.length < 6) return 'Unknown';
  const oui = norm.slice(0, 6);
  return OUI_VENDOR_TABLE[oui] || 'Unknown';
}
