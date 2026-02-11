# Edge Device Code Protection Analysis
**Farm:** Big Green Farm (FARM-MKLOMAT3-A9D8)  
**Edge Device:** 100.65.187.59  
**Date:** January 20, 2026  
**Security Assessment:** ⚠️ MINIMAL PROTECTION

---

## Executive Summary

**Security Status: ⚠️ LOW PROTECTION**

The code on the edge device has **MINIMAL protection**. The source code is **NOT obfuscated, NOT encrypted, and FULLY READABLE** on the device filesystem. However, it is **NOT exposed via HTTP**, which provides some basic protection.

### Protection Level: 2/10

- ❌ No code obfuscation
- ❌ No code encryption
- ❌ No source code minification
- ✅ Server files not exposed via HTTP
- ⚠️ Frontend JavaScript fully readable via HTTP
- ⚠️ Data files accessible via HTTP (required for app)
- ⚠️ Secrets in plain text .env file
- ✅ SSH requires authentication
- ⚠️ File permissions standard (rw-r--r--)

---

## 1. Filesystem Protection

### 1.1 File Permissions
```bash
drwxr-xr-x  48 greenreach greenreach  12288 Jan 20 20:29 .
-rw-r--r--   1 greenreach greenreach  13915 Jan 20 18:07 admin.js
-rw-r--r--   1 greenreach greenreach  17304 Jan 20 13:54 lib/automation-engine.js
-rw-r--r--   1 greenreach greenreach  10382 Jan 20 13:54 lib/farm-auth.js
-rw-r--r--   1 greenreach greenreach  10540 Jan 20 13:54 lib/license-manager.js
```

**Status: ⚠️ STANDARD PERMISSIONS**
- All files: `rw-r--r--` (644) - Owner can write, everyone can read
- **Risk:** Anyone with SSH access can read all source code
- **Risk:** Local users can read all source code

### 1.2 Source Code Visibility
```javascript
// Example from server-foxtrot.js - fully readable:
await import('dotenv/config');
import express from "express";
import { getJwtSecret } from './server/utils/secrets-manager.js';
import { authRateLimiter, rateLimiter } from './server/middleware/rate-limiter.js';
```

**Status: ❌ NO OBFUSCATION**
- Server code: Fully readable JavaScript with comments
- Library code: Fully readable with function names intact
- Logic: All business logic exposed
- Architecture: System design fully visible

---

## 2. HTTP Exposure

### 2.1 Server Code Protection
```bash
# Test: Can we access server code via HTTP?
$ curl http://127.0.0.1:8091/server-foxtrot.js
{"error":"Not Found","message":"Route GET /server-foxtrot.js not found"}

$ curl http://127.0.0.1:8091/lib/license-manager.js
{"error":"Not Found","message":"Route GET /lib/license-manager.js not found"}
```

**Status: ✅ SERVER CODE NOT EXPOSED VIA HTTP**
- Server files: NOT accessible via web
- Library files: NOT accessible via web
- Static file serving: Only `/public/` directory served

### 2.2 Frontend Code Exposure
```bash
# Test: Can we access frontend JavaScript?
$ curl http://127.0.0.1:8091/app.foxtrot.js
// API Base URL - uses window.API_BASE set in index.charlie.html
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : (typeof location !== 'undefined' ? location.origin : 'http://localhost:8091');
```

**Status: ⚠️ FRONTEND CODE FULLY EXPOSED VIA HTTP**
- **Required:** Frontend JavaScript MUST be accessible for web app to work
- **Risk:** Anyone can view frontend logic, API calls, data structures
- **Size:** app.foxtrot.js is 888 KB of unobfuscated JavaScript
- **Impact:** Medium - standard for web apps but exposes client-side logic

### 2.3 Data File Exposure
```bash
# Test: Can we access data files?
$ curl http://127.0.0.1:8091/data/farm.json
{
  "farmId": "FARM-MKLOMAT3-A9D8",
  "name": "Big Green Farm",
  "farmName": "Big Green Farm",
  "status": "online"
}
```

**Status: ⚠️ DATA FILES ACCESSIBLE VIA HTTP**
- **Required:** Data files MUST be accessible for frontend app
- **Risk:** Farm configuration, room layout, device groups visible to anyone who can access the web interface
- **Files Exposed:** 30 JSON files (452 KB)
- **Impact:** Medium - operational data visible but necessary for app functionality

### 2.4 Protected Files
```bash
# Test: Can we access sensitive files?
$ curl http://127.0.0.1:8091/.env
{"error":"Not Found","message":"Route GET /.env not found"}

$ curl http://127.0.0.1:8091/server-foxtrot.js
{"error":"Not Found","message":"Route GET /server-foxtrot.js not found"}
```

**Status: ✅ SENSITIVE FILES PROTECTED**
- `.env` file: NOT accessible via HTTP
- Server files: NOT accessible via HTTP
- Node modules: NOT accessible via HTTP
- Package.json: Accessible (standard for web apps)

---

## 3. Secrets & Credentials

### 3.1 Environment Variables
```bash
# Contents of .env file on edge device:
GREENREACH_CENTRAL_URL=https://greenreachgreens.com
FARM_ID=FARM-MKLOMAT3-A9D8
SYNC_ENABLED=true
SYNC_INTERVAL=300000
NODE_ENV=production
PORT=8091
GREENREACH_API_KEY=temp-dev-key-12345
GREENREACH_API_SECRET=temp-dev-secret-67890
EDGE_MODE=false
FARM_NAME=ReTerminal Edge Test
CTRL=http://192.168.2.232:3000
```

**Status: ❌ SECRETS IN PLAIN TEXT**
- **Risk:** Anyone with SSH access can read all secrets
- **Risk:** API keys stored unencrypted
- **Risk:** Production credentials in plain text
- **Impact:** HIGH - Compromised device = compromised API access

### 3.2 Hardcoded Secrets
```javascript
// From server-foxtrot.js:
import { getJwtSecret } from './server/utils/secrets-manager.js';
```

**Status: ⚠️ SECRETS LOADED FROM secrets-manager**
- JWT secrets: Loaded from secrets manager (better)
- **But:** secrets-manager.js source code is readable on filesystem
- **But:** If it uses environment variables, those are in plain .env

### 3.3 Private Keys
```bash
# Check for private keys:
$ ls /home/greenreach/Light-Engine-Foxtrot/config/*.pem
(none found)

$ ls /home/greenreach/Light-Engine-Foxtrot/*.key
(none found)
```

**Status: ✅ NO PRIVATE KEYS FOUND**
- No `.pem` files found
- No `.key` files found
- `.gitignore` configured to exclude private keys (good)

---

## 4. Access Control

### 4.1 Physical Access
**Status: ⚠️ DEVICE ACCESSIBLE**
- Device Location: On-premises at farm
- **Risk:** Anyone with physical access can read storage
- **Risk:** USB access allows data extraction
- **Risk:** No encryption at rest

### 4.2 SSH Access
**Status: ⚠️ SSH ENABLED, AUTHENTICATION REQUIRED**
- Port: 22 open on all interfaces (0.0.0.0)
- Authentication: Password or SSH key required
- **Protected:** Cannot access without credentials
- **Risk:** If SSH credentials compromised, full filesystem access

### 4.3 Web Access
**Status: ⚠️ WEB INTERFACE OPEN**
- Port: 8091 open on all interfaces (0.0.0.0)
- Authentication: Token-based for API endpoints
- **Risk:** Frontend code and data files accessible without authentication
- **Risk:** Anyone on local network can view source code via browser

### 4.4 Network Segmentation
**Status: ⚠️ ALL PORTS ON ALL INTERFACES**
```bash
tcp  0.0.0.0:22    LISTEN  (SSH - accessible from anywhere)
tcp  0.0.0.0:8000  LISTEN  (Python - accessible from anywhere)
tcp  0.0.0.0:8091  LISTEN  (Node - accessible from anywhere)
```
- **Risk:** Services accessible from any network interface
- **Risk:** No firewall restricting access to local network only
- **Recommendation:** Bind to 127.0.0.1 or local network only

---

## 5. Code Obfuscation

### 5.1 Server Code
**Status: ❌ NO OBFUSCATION**
- Format: Plain JavaScript ES6 modules
- Comments: Present and readable
- Function Names: Clear and descriptive
- Variable Names: Clear and descriptive

**Example from lib/license-manager.js:**
```javascript
function hasFeature(feature) {
  if (process.env.EDGE_MODE === 'true') {
    return true; // All features enabled for edge devices
  }
  const license = validateLicense();
  if (!license.valid) return false;
  return license.features.includes(feature);
}
```

**Status: ❌ FULLY READABLE** - Business logic completely exposed

### 5.2 Frontend Code
**Status: ❌ NO OBFUSCATION OR MINIFICATION**
- Format: Plain JavaScript with comments
- Size: 888 KB (not minified)
- Function Names: Clear descriptive names
- API Endpoints: All visible in code

**Example from app.foxtrot.js:**
```javascript
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) 
  ? window.API_BASE 
  : (typeof location !== 'undefined' ? location.origin : 'http://localhost:8091');
```

**Status: ❌ FULLY READABLE** - All API endpoints and logic visible

---

## 6. Static File Serving Configuration

### 6.1 Express Static Middleware
```javascript
// From server-foxtrot.js line 17952:
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, path) => {
    // Force no-cache for HTML files to ensure latest UI
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Cache JS/CSS for 1 hour but allow revalidation
    else if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
  }
}));
```

**Status: ✅ PROPER CONFIGURATION**
- Only `/public/` directory served
- `.env` not served (not in public dir)
- Server files not served (not in public dir)
- **But:** No dotfile exclusion explicitly configured

### 6.2 Files NOT Exposed
- ✅ `server-foxtrot.js` - Returns 404
- ✅ `/lib/*.js` - Returns 404
- ✅ `/server/*.js` - Returns 404
- ✅ `.env` - Returns 404
- ✅ `node_modules/` - Not served

### 6.3 Files Exposed (Required)
- ⚠️ `/public/app.foxtrot.js` - Frontend logic
- ⚠️ `/public/data/*.json` - Farm data
- ⚠️ `/public/*.html` - All pages
- ⚠️ `/public/package.json` - Dependencies list

---

## 7. Attack Vectors

### 7.1 Physical Access
**Severity: HIGH**
1. Attacker gains physical access to reTerminal device
2. Boots from USB or accesses storage
3. Reads all source code and secrets from filesystem
4. **Result:** Complete source code theft, API keys compromised

**Mitigation:** 
- ❌ No disk encryption currently
- ❌ No BIOS password
- ❌ No physical security (device is accessible on farm)

### 7.2 Network Access (Local Network)
**Severity: MEDIUM**
1. Attacker connects to farm WiFi ("redbrick")
2. Accesses http://100.65.187.59:8091/
3. Views all frontend JavaScript source code
4. Reads all data files via /data/*.json endpoints
5. **Result:** Frontend logic exposed, farm data visible

**Mitigation:**
- ⚠️ WiFi password protection (weak if shared)
- ⚠️ No HTTPS (traffic unencrypted)
- ⚠️ No IP whitelisting

### 7.3 SSH Compromise
**Severity: HIGH**
1. Attacker obtains SSH credentials via phishing/brute force
2. SSH to greenreach@100.65.187.59
3. Reads all source code files
4. Reads .env file with API keys
5. **Result:** Complete source code theft, credential theft

**Mitigation:**
- ⚠️ SSH key authentication recommended (check if enabled)
- ⚠️ No fail2ban or brute force protection verified
- ⚠️ Default greenreach user account

### 7.4 Remote Code Extraction
**Severity: LOW**
1. Attacker accesses web interface from internet (if exposed)
2. Downloads all frontend JavaScript files
3. Analyzes client-side code for vulnerabilities
4. **Result:** Limited - only frontend code exposed, not server logic

**Mitigation:**
- ✅ Server code not exposed via HTTP
- ⚠️ Frontend code necessarily exposed
- ⚠️ API endpoints visible in frontend code

---

## 8. Comparison to Industry Standards

### 8.1 Typical IoT Device Protection
| Protection Method | Industry Standard | Edge Device | Status |
|-------------------|-------------------|-------------|--------|
| Code Obfuscation | Medium-High | None | ❌ |
| Code Encryption | Medium | None | ❌ |
| Secrets Encryption | High | Plain text | ❌ |
| Disk Encryption | Medium | Not enabled | ❌ |
| Secure Boot | Medium | Unknown | ❓ |
| Code Signing | Medium | Not implemented | ❌ |
| Hardware Security Module | Low-Medium | No | ❌ |
| Network Segmentation | High | All interfaces | ⚠️ |

### 8.2 Web Application Standards
| Protection Method | Industry Standard | Edge Device | Status |
|-------------------|-------------------|-------------|--------|
| HTTPS/TLS | High | Not enabled | ❌ |
| Minified JavaScript | Medium | Not minified | ❌ |
| API Authentication | High | Token-based | ✅ |
| Rate Limiting | High | Implemented | ✅ |
| CORS Headers | High | Implemented | ✅ |

---

## 9. Recommendations

### 9.1 Critical (Implement Immediately)
1. **Enable Disk Encryption**
   - Use LUKS to encrypt edge device storage
   - Protects source code from physical access attacks
   - **Impact:** Prevents code theft if device stolen

2. **Encrypt .env File**
   - Use `ansible-vault` or similar to encrypt secrets
   - Decrypt at runtime with master key from hardware
   - **Impact:** Protects API keys from filesystem access

3. **Enable HTTPS**
   - Configure Let's Encrypt or self-signed certificate
   - Encrypt all web traffic
   - **Impact:** Prevents traffic sniffing on local network

### 9.2 High Priority (Implement This Week)
4. **Restrict Network Binding**
   - Change `0.0.0.0` to `127.0.0.1` for sensitive services
   - Or bind to local network only (100.65.x.x)
   - **Impact:** Prevents access from outside local network

5. **Obfuscate Frontend JavaScript**
   - Use JavaScript obfuscator (javascript-obfuscator)
   - Minify with aggressive settings
   - **Impact:** Makes reverse engineering much harder

6. **Implement SSH Key-Only Authentication**
   - Disable password authentication
   - Require SSH keys only
   - **Impact:** Prevents brute force attacks

7. **Add fail2ban for SSH**
   - Automatically ban repeated failed login attempts
   - **Impact:** Protects against SSH brute force

### 9.3 Medium Priority (Implement This Month)
8. **Code Signing**
   - Sign all JavaScript files with digital signature
   - Verify signatures at startup
   - **Impact:** Detect if code has been tampered with

9. **Secrets Management Service**
   - Use HashiCorp Vault or AWS Secrets Manager
   - Store secrets in encrypted vault, not .env
   - **Impact:** Centralized, audited secret access

10. **Secure Boot**
    - Enable UEFI Secure Boot on reTerminal
    - Prevent unauthorized OS boot
    - **Impact:** Protects against malicious bootloaders

### 9.4 Low Priority (Nice to Have)
11. **Hardware Security Module (HSM)**
    - Use TPM chip if available on reTerminal
    - Store encryption keys in hardware
    - **Impact:** Maximum key security

12. **License File Encryption**
    - Encrypt license files with public/private key
    - Verify signatures on startup
    - **Impact:** Prevent license tampering

13. **API Key Rotation**
    - Automatically rotate API keys monthly
    - **Impact:** Limits damage from key compromise

---

## 10. Risk Assessment

### 10.1 Current Risk Level: MEDIUM-HIGH ⚠️

**Probability of Attack:**
- Physical Access: LOW (device on private farm)
- Local Network Access: MEDIUM (farm WiFi accessible)
- SSH Compromise: LOW-MEDIUM (if weak password)
- Remote Attack: LOW (not exposed to internet)

**Impact of Successful Attack:**
- Source Code Theft: HIGH (complete IP loss)
- API Key Compromise: HIGH (unauthorized central API access)
- Farm Data Exposure: MEDIUM (operational data visible)
- System Takeover: HIGH (full control of edge device)

**Overall Risk:** 
- **Without Additional Protections:** 7/10 (HIGH)
- **With Critical Fixes:** 4/10 (MEDIUM)
- **With All Recommendations:** 2/10 (LOW)

---

## 11. Comparison: Edge Device vs. SaaS Deployment

### 11.1 Edge Device (Current)
**Advantages:**
- ✅ Server code not exposed via HTTP
- ✅ Isolated from internet (lower attack surface)
- ✅ Physical security (on private property)

**Disadvantages:**
- ❌ No code obfuscation
- ❌ Secrets in plain text
- ❌ No disk encryption
- ❌ Source code fully readable on filesystem

### 11.2 SaaS/Cloud Deployment
**Advantages:**
- ✅ Code never deployed to customer premises
- ✅ Secrets in encrypted secrets manager
- ✅ Disk encryption standard
- ✅ Network hardening and firewalls

**Disadvantages:**
- ⚠️ Frontend code still exposed (same as edge)
- ⚠️ More attack surface (exposed to internet)
- ⚠️ Multi-tenant security concerns

---

## 12. What IS Protected

### 12.1 Server-Side Logic ✅
- **Protected From:** HTTP access
- **Not Protected From:** SSH access, physical access
- **Risk Level:** MEDIUM

### 12.2 API Keys ⚠️
- **Protected From:** HTTP access
- **Not Protected From:** SSH access, physical access, .env file reading
- **Risk Level:** HIGH

### 12.3 Database ✅
- **Protected From:** HTTP access (no direct SQL injection)
- **Not Protected From:** SSH access, filesystem access
- **Risk Level:** MEDIUM

### 12.4 Business Logic ❌
- **Frontend:** Fully exposed via HTTP (required)
- **Backend:** Exposed via SSH/physical access
- **Risk Level:** HIGH

---

## 13. What is NOT Protected

### 13.1 Frontend Code ❌
- **Status:** Fully visible via HTTP
- **Reason:** Required for web app to function
- **Cannot Be Fixed:** Inherent to web applications
- **Mitigation:** Obfuscation, minification

### 13.2 Source Code on Filesystem ❌
- **Status:** Fully readable with SSH access
- **Reason:** JavaScript interpreted language
- **Can Be Fixed:** Disk encryption, file permissions
- **Risk:** HIGH if SSH compromised

### 13.3 Environment Variables ❌
- **Status:** Plain text in .env file
- **Reason:** Standard practice but insecure
- **Can Be Fixed:** Encryption, secrets manager
- **Risk:** HIGH if SSH compromised

### 13.4 Farm Data ⚠️
- **Status:** Accessible via HTTP (required for app)
- **Reason:** Frontend needs to read data files
- **Can Be Fixed:** Require authentication for /data/ endpoints
- **Risk:** MEDIUM

---

## 14. Conclusion

### Protection Score: 2/10 ⚠️

The edge device code is **MINIMALLY PROTECTED**:

**What Works:**
- ✅ Server files not exposed via HTTP
- ✅ .env file not exposed via HTTP
- ✅ SSH authentication required
- ✅ API authentication implemented

**What Doesn't Work:**
- ❌ No code obfuscation
- ❌ No code encryption
- ❌ No disk encryption
- ❌ Secrets in plain text
- ❌ All source code readable with SSH access
- ❌ No HTTPS

**Bottom Line:**
The system relies entirely on **perimeter security** (SSH authentication, network isolation). If an attacker gains SSH access or physical access to the device, **ALL source code and secrets are immediately compromised**.

**Recommended Action:**
Implement at minimum the **3 Critical recommendations** (disk encryption, secrets encryption, HTTPS) to raise protection level to 6/10.

---

**Report Generated:** January 20, 2026  
**Next Review:** After implementing critical recommendations  
**Security Auditor:** AI Engineering Assistant
