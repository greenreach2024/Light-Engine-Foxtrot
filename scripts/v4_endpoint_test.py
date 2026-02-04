import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

BASE = "http://greenreach-central.us-east-1.elasticbeanstalk.com"
ROOT = Path("/Users/petergilbert/Light-Engine-Foxtrot/greenreach-central")
SERVER = ROOT / "server.js"
RESULTS_FILE = Path("/tmp/v4-endpoint-results.txt")

server_src = SERVER.read_text(encoding="utf-8")

import_re = re.compile(r"import\s+(\w+)\s+from\s+['\"]\.\/routes\/([^'\"]+)['\"]")
imports = {m.group(1): (ROOT / "routes" / m.group(2)) for m in import_re.finditer(server_src)}

# Extract app.use mounts with a line-based parse (more resilient to comments/middleware)
mounts = []
for line in server_src.splitlines():
    if "app.use(" not in line:
        continue
    if "app.use('/api" not in line and 'app.use("/api' not in line:
        continue
    m = re.search(r"app\.use\(\s*['\"]([^'\"]+)['\"]\s*,(.*)\)", line)
    if not m:
        continue
    prefix = m.group(1).strip()
    rest = m.group(2)
    # Remove inline comments
    rest = rest.split("//")[0].strip()
    # Split args and take last as router variable
    parts = [p.strip() for p in rest.split(",") if p.strip()]
    if not parts:
        continue
    var = parts[-1].strip()
    var = var.rstrip(");").strip()
    mounts.append((prefix, var))

route_re = re.compile(r"router\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]")
app_route_re = re.compile(r"app\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]")

routes = []

# App-level routes
for m in app_route_re.finditer(server_src):
    routes.append((m.group(1), m.group(2)))

# Router-mounted routes
for prefix, var_name in mounts:
    route_file = imports.get(var_name)
    if not route_file or not route_file.exists():
        continue
    src = route_file.read_text(encoding="utf-8")
    for m in route_re.finditer(src):
        full = (prefix + "/" + m.group(2))
        full = re.sub(r"/+", "/", full)
        routes.append((m.group(1), full))

# Deduplicate
seen = set()
unique_routes = []
for method, path in routes:
    key = f"{method} {path}"
    if key in seen:
        continue
    seen.add(key)
    unique_routes.append((method, path))

unique_routes.sort()

# Test GET endpoints only (non-GET are listed as skipped to avoid side effects)
RESULTS_FILE.write_text("", encoding="utf-8")

status_counts = {}

def record(line):
    RESULTS_FILE.write_text(RESULTS_FILE.read_text(encoding="utf-8") + line + "\n", encoding="utf-8")

for method, path in unique_routes:
    if method != "get":
        record(f"SKIP {method.upper()} {path}")
        status_counts["SKIP"] = status_counts.get("SKIP", 0) + 1
        continue
    url_path = re.sub(r":[A-Za-z0-9_]+", "test", path)
    url = BASE + url_path
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            code = resp.getcode()
        record(f"{code} GET {path}")
        status_counts[str(code)] = status_counts.get(str(code), 0) + 1
    except urllib.error.HTTPError as e:
        record(f"{e.code} GET {path}")
        status_counts[str(e.code)] = status_counts.get(str(e.code), 0) + 1
    except Exception:
        record(f"ERR GET {path}")
        status_counts["ERR"] = status_counts.get("ERR", 0) + 1

print(f"Total routes: {len(unique_routes)}")
print(f"GET tested: {sum(1 for m, _ in unique_routes if m == 'get')}")
print("Status counts:")
for key in sorted(status_counts.keys()):
    print(f"  {key}: {status_counts[key]}")

print("\nSample results (first 40 lines):")
lines = RESULTS_FILE.read_text(encoding="utf-8").splitlines()
for line in lines[:40]:
    print(line)
