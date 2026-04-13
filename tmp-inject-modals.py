#!/usr/bin/env python3
"""
Inject missing wizard modal HTML from LE-dashboard.html into
farm-setup.html and grow-management.html.
"""
import re

DASHBOARD = 'greenreach-central/public/LE-dashboard.html'
FARM_SETUP = 'greenreach-central/public/views/farm-setup.html'
GROW_MGMT = 'greenreach-central/public/views/grow-management.html'

with open(DASHBOARD, 'r') as f:
    dash = f.read()
    dash_lines = dash.split('\n')


def extract_block(text, start_pattern, end_tag='</div>', nested_tag='<div'):
    """Extract an HTML block starting at pattern, counting nested open/close tags."""
    m = re.search(start_pattern, text)
    if not m:
        print(f"WARNING: Could not find pattern: {start_pattern}")
        return ''
    start = m.start()
    # Count nesting of the outer tag
    tag_name = None
    # Find the actual tag
    if '<dialog' in text[start:start+50]:
        open_tag = '<dialog'
        close_tag = '</dialog>'
    elif '<div' in text[start:start+50]:
        open_tag = '<div'
        close_tag = '</div>'
    elif '<form' in text[start:start+50]:
        open_tag = '<form'
        close_tag = '</form>'
    else:
        open_tag = '<div'
        close_tag = '</div>'

    depth = 0
    i = start
    while i < len(text):
        if text[i:].startswith(open_tag) and (text[i+len(open_tag)] in (' ', '>', '\n', '\t', '\r')):
            depth += 1
            i += len(open_tag)
        elif text[i:].startswith(close_tag):
            depth -= 1
            if depth == 0:
                end = i + len(close_tag)
                return text[start:end]
            i += len(close_tag)
        else:
            i += 1
    print(f"WARNING: Could not find end of block for: {start_pattern}")
    return text[start:]


# Extract each modal from dashboard
farm_modal = extract_block(dash, r'<div id="farmModal"')
room_modal = extract_block(dash, r'<div id="roomModal"')
fresh_light_modal = extract_block(dash, r'<div id="freshLightModal"')
device_pair_modal = extract_block(dash, r'<div id="devicePairModal"')
device_manager = extract_block(dash, r'<div id="deviceManager"')
cal_modal = extract_block(dash, r'<div id="calModal"')
bulk_edit_modal = extract_block(dash, r'<dialog id="bulkEditGroupModal"')
bsg_modal = extract_block(dash, r'<dialog id="buildStockGroupModal"')

print(f"farmModal: {len(farm_modal)} chars")
print(f"roomModal: {len(room_modal)} chars")
print(f"freshLightModal: {len(fresh_light_modal)} chars")
print(f"devicePairModal: {len(device_pair_modal)} chars")
print(f"deviceManager: {len(device_manager)} chars")
print(f"calModal: {len(cal_modal)} chars")
print(f"bulkEditModal: {len(bulk_edit_modal)} chars")
print(f"bsgModal: {len(bsg_modal)} chars")

# Toast container
toasts_html = '  <div id="toasts" class="toast-container" aria-live="polite" aria-atomic="true"></div>'

# ---- Inject into farm-setup.html ----
with open(FARM_SETUP, 'r') as f:
    farm_html = f.read()

farm_modals_block = f"""
  <!-- ===== WIZARD MODALS (extracted from LE-dashboard.html) ===== -->

  {farm_modal}

  {room_modal}

  {fresh_light_modal}

  {device_pair_modal}

  {device_manager}

  {toasts_html}
"""

# Insert before </body>
if '</body>' in farm_html:
    farm_html = farm_html.replace('</body>', farm_modals_block + '\n</body>')
    with open(FARM_SETUP, 'w') as f:
        f.write(farm_html)
    print(f"\nInjected modals into {FARM_SETUP}")
else:
    print(f"ERROR: Could not find </body> in {FARM_SETUP}")

# ---- Inject into grow-management.html ----
with open(GROW_MGMT, 'r') as f:
    grow_html = f.read()

grow_modals_block = f"""
  <!-- ===== WIZARD MODALS (extracted from LE-dashboard.html) ===== -->

  {cal_modal}

  {bulk_edit_modal}

  {bsg_modal}

  {toasts_html}
"""

if '</body>' in grow_html:
    grow_html = grow_html.replace('</body>', grow_modals_block + '\n</body>')
    with open(GROW_MGMT, 'w') as f:
        f.write(grow_html)
    print(f"Injected modals into {GROW_MGMT}")
else:
    print(f"ERROR: Could not find </body> in {GROW_MGMT}")

print("\nDone! Verify with grep for modal IDs.")
