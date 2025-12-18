#!/usr/bin/env python3
"""
Merge DLC Total CSV fixtures into device-kb.json
Converts DLC database format to Light Engine fixture format
"""

import csv
import json
import sys
from pathlib import Path

def parse_control_method(row):
    """Determine control method from DLC columns"""
    # Check for various control types
    if row.get('0-10V ANSI C137.1 (8V)') or row.get('0-10V ANSI C137.1 (9V)') or row.get('0-10V IEC60929 Annex E'):
        return '0-10V'
    elif row.get('DALI') or row.get('DALI-2'):
        return 'DALI'
    elif row.get('Wi-Fi'):
        return 'WiFi'
    elif row.get('Ethernet TCP/IP'):
        return 'Ethernet'
    elif row.get('Zigbee 3.0') or row.get('Zigbee - Manufacturer Specific'):
        return 'Zigbee'
    elif row.get('Bluetooth Sig MESH and MMDL Layers') or row.get('Bluetooth - Manufacturer Specific'):
        return 'BLE'
    elif row.get('Power Over Ethernet'):
        return 'PoE'
    elif 'RS485' in row.get('Dimming and Control Method to the Product', ''):
        return 'RS485'
    elif row.get('Dimmable') == 'TRUE':
        return '0-10V'  # Default for dimmable
    else:
        return 'Manual'

def safe_float(value, default=0):
    """Safely convert to float"""
    try:
        if value and value.strip():
            return float(value)
        return default
    except (ValueError, AttributeError):
        return default

def safe_int(value, default=0):
    """Safely convert to int"""
    try:
        if value and value.strip():
            return int(float(value))
        return default
    except (ValueError, AttributeError):
        return default

def create_fixture_id(manufacturer, model):
    """Generate fixture ID from manufacturer and model"""
    # Clean and convert to lowercase kebab-case
    mfg = manufacturer.lower().replace(' ', '-').replace(',', '').replace('.', '')
    mdl = model.lower().replace(' ', '-').replace(',', '').replace('.', '')
    # Remove extra hyphens
    mfg = '-'.join(filter(None, mfg.split('-')))
    mdl = '-'.join(filter(None, mdl.split('-')))
    return f"{mfg}-{mdl}"

def convert_dlc_to_fixture(row):
    """Convert DLC CSV row to Light Engine fixture format"""
    manufacturer = row.get('Manufacturer', '').strip()
    model = row.get('Model Number', '').strip()
    
    if not manufacturer or not model:
        return None
    
    # Calculate PPFD from flux and assume standard mounting height
    ppfd_flux = safe_float(row.get('Tested Photosynthetic Photon Flux (400-700nm)') or 
                           row.get('Reported Photosynthetic Photon Flux (400-700nm)'))
    # Rough PPFD estimate: flux / coverage area (assuming 4x4 ft = 1.5 m²)
    ppfd_estimate = int(ppfd_flux / 1.5) if ppfd_flux > 0 else 0
    
    # Get wattage
    watts = safe_int(row.get('Tested Input Wattage') or row.get('Reported Input Wattage'))
    
    # Determine tunability
    spectrally_tunable = row.get('Spectrally Tunable', '').strip().lower()
    is_tunable = spectrally_tunable in ['yes', 'true', '1']
    
    # Get spectral data
    blue_flux = safe_float(row.get('Tested Photon Flux Blue (400-500nm)') or 
                           row.get('Reported Photon Flux Blue (400-500nm)'))
    green_flux = safe_float(row.get('Tested Photon Flux Green (500-600nm)') or 
                            row.get('Reported Photon Flux Green (500-600nm)'))
    red_flux = safe_float(row.get('Tested Photon Flux Red (600-700nm)') or 
                          row.get('Reported Photon Flux Red (600-700nm)'))
    far_red_flux = safe_float(row.get('Tested Photon Flux Far Red (700-800nm)') or 
                              row.get('Reported Photon Flux Far Red (700-800nm)'))
    
    # Calculate factory spectrum percentages
    total_flux = blue_flux + green_flux + red_flux + far_red_flux
    factory_spectrum = None
    if total_flux > 0 and not is_tunable:
        # Map to 4-channel system (CW, WW, BL, RD)
        # Approximate: green+some blue -> CW, red+far red -> WW, pure blue -> BL, pure red -> RD
        factory_spectrum = {
            "cw": int((green_flux + blue_flux * 0.3) / total_flux * 100),
            "ww": int((red_flux * 0.3 + far_red_flux) / total_flux * 100),
            "bl": int((blue_flux * 0.7) / total_flux * 100),
            "rd": int((red_flux * 0.7) / total_flux * 100)
        }
        # Normalize to 100%
        total_pct = sum(factory_spectrum.values())
        if total_pct > 0:
            factory_spectrum = {k: int(v / total_pct * 100) for k, v in factory_spectrum.items()}
    
    # Build fixture object
    fixture = {
        "id": create_fixture_id(manufacturer, model),
        "vendor": manufacturer,
        "model": model,
        "watts": watts,
        "control": parse_control_method(row),
        "ppfd": ppfd_estimate,
        "spectrum": "Full Spectrum",
        "spectrally_tunable": spectrally_tunable.capitalize() if spectrally_tunable else "No",
        "tunable": is_tunable,
        "dynamicSpectrum": is_tunable,
    }
    
    # Add factory spectrum for static lights
    if factory_spectrum and not is_tunable:
        fixture["factorySpectrum"] = factory_spectrum
    
    # Add channels for tunable lights
    if is_tunable:
        fixture["channels"] = ["cw", "ww", "bl", "rd"]
    
    # Add DLC-specific data
    dlc_data = {}
    if row.get('Product ID'):
        dlc_data['product_id'] = row['Product ID']
    if row.get('DLC Family Code'):
        dlc_data['family_code'] = row['DLC Family Code']
    if row.get('Date Qualified'):
        dlc_data['date_qualified'] = row['Date Qualified']
    
    ppf_efficacy = safe_float(row.get('Tested Photosynthetic Photon Efficacy (400-700nm)') or 
                              row.get('Reported Photosynthetic Photon Efficacy (400-700nm)'))
    if ppf_efficacy > 0:
        dlc_data['ppf_efficacy'] = ppf_efficacy
    
    if dlc_data:
        fixture['dlc'] = dlc_data
    
    # Generate tags
    tags = [
        manufacturer.lower().replace(' ', '-'),
        model.lower().replace(' ', '-'),
        fixture['control'].lower()
    ]
    if is_tunable:
        tags.append('tunable')
    else:
        tags.append('static')
    
    if ppf_efficacy > 2.5:
        tags.append('high-efficiency')
    if watts > 600:
        tags.append('high-power')
    
    fixture['tags'] = tags
    
    return fixture

def merge_fixtures(existing_path, csv_path, output_path):
    """Merge DLC CSV fixtures with existing device-kb.json"""
    # Load existing fixtures
    with open(existing_path, 'r') as f:
        db = json.load(f)
    
    existing_fixtures = db.get('fixtures', [])
    existing_ids = {f['id'] for f in existing_fixtures}
    
    print(f"Loaded {len(existing_fixtures)} existing fixtures")
    
    # Load DLC CSV
    new_fixtures = []
    skipped = 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fixture = convert_dlc_to_fixture(row)
            if fixture:
                # Check for duplicates
                if fixture['id'] not in existing_ids:
                    new_fixtures.append(fixture)
                    existing_ids.add(fixture['id'])
                else:
                    skipped += 1
            else:
                skipped += 1
    
    print(f"Converted {len(new_fixtures)} new fixtures from DLC CSV")
    print(f"Skipped {skipped} entries (duplicates or invalid data)")
    
    # Merge fixtures
    all_fixtures = existing_fixtures + new_fixtures
    
    # Sort by vendor, then model
    all_fixtures.sort(key=lambda f: (f['vendor'].lower(), f['model'].lower()))
    
    # Write output
    db['fixtures'] = all_fixtures
    
    with open(output_path, 'w') as f:
        json.dump(db, f, indent=2)
    
    print(f"Wrote {len(all_fixtures)} total fixtures to {output_path}")
    
    return len(new_fixtures), len(all_fixtures)

if __name__ == '__main__':
    # Paths
    script_dir = Path(__file__).parent
    project_dir = script_dir.parent
    
    existing_db = project_dir / 'public' / 'data' / 'device-kb.json'
    dlc_csv = Path('/Users/petergilbert/Desktop/GreenReach/DLC - Total.csv')
    output_db = existing_db  # Overwrite existing
    backup_db = project_dir / 'public' / 'data' / 'device-kb.json.backup'
    
    # Create backup
    print(f"Creating backup: {backup_db}")
    import shutil
    shutil.copy(existing_db, backup_db)
    
    # Merge
    new_count, total_count = merge_fixtures(existing_db, dlc_csv, output_db)
    
    # Also update docs version
    docs_db = project_dir / 'docs' / 'data' / 'device-kb.json'
    shutil.copy(output_db, docs_db)
    print(f"Synced to {docs_db}")
    
    print(f"\n Success! Added {new_count} new fixtures (total: {total_count})")
    print(f"Backup saved to: {backup_db}")
