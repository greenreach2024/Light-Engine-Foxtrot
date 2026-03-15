#!/usr/bin/env python3
"""Analyze nginx logs to extract metadata about lost campaign signups."""
import sys, re, glob
from collections import Counter

logdir = ".elasticbeanstalk/logs/latest/i-02f872094f3686844/var/log"
lines = []

# Current access log
try:
    with open(f"{logdir}/nginx/access.log") as f:
        lines += [l for l in f if "campaign/signup" in l]
except FileNotFoundError:
    pass

# Rotated access logs
import gzip
for gz in sorted(glob.glob(f"{logdir}/nginx/rotated/access.log*.gz")):
    with gzip.open(gz, 'rt') as f:
        lines += [l for l in f if "campaign/signup" in l]

# Filter out test curls
lines = [l for l in lines if "curl/" not in l]

entries = []
for line in lines:
    ts = re.search(r'\[([^\]]+)\]', line)
    # Real client IP is last quoted field: "1.2.3.4"
    all_quoted = re.findall(r'"([^"]*)"', line)
    ip_match = all_quoted[-1].strip() if all_quoted else '?'
    source = 'direct'
    if 'fbclid' in line: source = 'facebook'
    elif 'LinkedIn' in line: source = 'linkedin'
    device = 'unknown'
    if 'iPhone' in line: device = 'iPhone'
    elif 'Android' in line or 'Pixel' in line: device = 'Android'
    elif 'Macintosh' in line: device = 'Mac'
    elif 'Windows' in line: device = 'Windows'
    entries.append((ts.group(1) if ts else '?', ip_match, device, source))

entries.sort()
print(f"Total lost signups: {len(entries)}")
print("---")
print(f"{'#':<4} {'Timestamp':<30} {'IP':<18} {'Device':<10} {'Source':<10}")
print("-" * 80)
for i, (ts, ip, dev, src) in enumerate(entries, 1):
    print(f"{i:<4} {ts:<30} {ip:<18} {dev:<10} {src:<10}")

print()
src_counts = Counter(src for _, _, _, src in entries)
dev_counts = Counter(dev for _, _, dev, _ in entries)
unique_ips = len(set(ip for _, ip, _, _ in entries))
ip_dups = [(ip, cnt) for ip, cnt in Counter(ip for _, ip, _, _ in entries).items() if cnt > 1]

print(f"Unique IPs: {unique_ips}")
print(f"Sources: {dict(src_counts)}")
print(f"Devices: {dict(dev_counts)}")
if ip_dups:
    print(f"Repeat IPs (possible re-signups): {ip_dups}")
