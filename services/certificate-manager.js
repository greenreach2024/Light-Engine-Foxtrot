/**
 * Certificate Manager Service
 * 
 * Manages TLS certificates for mutual authentication between edge devices and GreenReach Central.
 * Handles certificate provisioning, storage, rotation, and renewal.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import EventEmitter from 'events';

const execAsync = promisify(exec);

export default class CertificateManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      certDir: config.certDir || process.env.CERT_DIR || '/etc/greenreach/certs',
      centralUrl: config.centralUrl || process.env.GREENREACH_CENTRAL_URL || 'https://api.greenreach.com',
      farmId: config.farmId || process.env.FARM_ID,
      apiKey: config.apiKey || process.env.GREENREACH_API_KEY,
      
      // Certificate settings
      keySize: 2048,
      validityDays: 365,
      renewBeforeDays: 30, // Renew 30 days before expiry
      
      // Check interval
      checkInterval: 24 * 60 * 60 * 1000, // Check daily
      
      ...config
    };
    
    this.checkTimer = null;
  }
  
  /**
   * Initialize certificate manager
   */
  async initialize() {
    console.log('[cert-manager] Initializing certificate manager...');
    
    // Ensure certificate directory exists
    await this.ensureCertDirectory();
    
    // Check if certificates exist
    const hasValidCert = await this.hasValidCertificate();
    
    if (!hasValidCert) {
      console.log('[cert-manager] No valid certificate found, provisioning new certificate...');
      await this.provisionCertificate();
    } else {
      console.log('[cert-manager] Valid certificate found');
    }
    
    // Start periodic certificate check
    this.startCertificateCheck();
    
    console.log('[cert-manager] Certificate manager initialized');
    this.emit('initialized');
  }
  
  /**
   * Ensure certificate directory exists
   */
  async ensureCertDirectory() {
    try {
      await fs.mkdir(this.config.certDir, { recursive: true, mode: 0o700 });
      console.log('[cert-manager] Certificate directory ready:', this.config.certDir);
    } catch (error) {
      console.error('[cert-manager] Failed to create certificate directory:', error);
      throw error;
    }
  }
  
  /**
   * Check if valid certificate exists
   */
  async hasValidCertificate() {
    try {
      const certPath = this.getCertificatePath('cert');
      const keyPath = this.getCertificatePath('key');
      
      // Check if files exist
      await fs.access(certPath);
      await fs.access(keyPath);
      
      // Check certificate validity
      const certInfo = await this.getCertificateInfo(certPath);
      
      if (certInfo.valid && certInfo.daysUntilExpiry > this.config.renewBeforeDays) {
        console.log(`[cert-manager] Certificate valid for ${certInfo.daysUntilExpiry} days`);
        return true;
      }
      
      console.log('[cert-manager] Certificate expired or expiring soon');
      return false;
      
    } catch (error) {
      console.log('[cert-manager] Certificate check failed:', error.message);
      return false;
    }
  }
  
  /**
   * Provision new certificate from GreenReach Central
   */
  async provisionCertificate() {
    try {
      console.log('[cert-manager] Provisioning certificate for farm:', this.config.farmId);
      
      // Generate CSR (Certificate Signing Request)
      const { csr, privateKey } = await this.generateCSR();
      
      // Request certificate from Central API
      const response = await fetch(`${this.config.centralUrl}/api/certs/provision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Farm-ID': this.config.farmId
        },
        body: JSON.stringify({
          farmId: this.config.farmId,
          csr: csr
        })
      });
      
      if (!response.ok) {
        throw new Error(`Certificate provisioning failed: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Save certificate and private key
      await this.saveCertificate(result.certificate, privateKey, result.caCertificate);
      
      console.log('[cert-manager] Certificate provisioned successfully');
      this.emit('certificate_provisioned', result);
      
      return result;
      
    } catch (error) {
      console.error('[cert-manager] Certificate provisioning error:', error);
      this.emit('provisioning_error', error);
      throw error;
    }
  }
  
  /**
   * Generate Certificate Signing Request (CSR)
   */
  async generateCSR() {
    console.log('[cert-manager] Generating CSR...');
    
    const keyPath = path.join(this.config.certDir, 'temp.key');
    const csrPath = path.join(this.config.certDir, 'temp.csr');
    
    try {
      // Generate private key
      await execAsync(`openssl genrsa -out ${keyPath} ${this.config.keySize}`);
      
      // Generate CSR
      const subject = `/C=US/ST=Oregon/L=Portland/O=GreenReach/CN=${this.config.farmId}`;
      await execAsync(`openssl req -new -key ${keyPath} -out ${csrPath} -subj "${subject}"`);
      
      // Read CSR and private key
      const csr = await fs.readFile(csrPath, 'utf8');
      const privateKey = await fs.readFile(keyPath, 'utf8');
      
      // Clean up temp files
      await fs.unlink(csrPath);
      
      console.log('[cert-manager] CSR generated successfully');
      
      return { csr, privateKey };
      
    } catch (error) {
      console.error('[cert-manager] CSR generation error:', error);
      // Clean up on error
      try {
        await fs.unlink(keyPath);
        await fs.unlink(csrPath);
      } catch {}
      throw error;
    }
  }
  
  /**
   * Save certificate and private key
   */
  async saveCertificate(certificate, privateKey, caCertificate) {
    try {
      const certPath = this.getCertificatePath('cert');
      const keyPath = this.getCertificatePath('key');
      const caPath = this.getCertificatePath('ca');
      
      // Save certificate
      await fs.writeFile(certPath, certificate, { mode: 0o600 });
      console.log('[cert-manager] Certificate saved:', certPath);
      
      // Save private key
      await fs.writeFile(keyPath, privateKey, { mode: 0o600 });
      console.log('[cert-manager] Private key saved:', keyPath);
      
      // Save CA certificate
      if (caCertificate) {
        await fs.writeFile(caPath, caCertificate, { mode: 0o600 });
        console.log('[cert-manager] CA certificate saved:', caPath);
      }
      
      // Remove temp key if it exists
      const tempKeyPath = path.join(this.config.certDir, 'temp.key');
      try {
        await fs.unlink(tempKeyPath);
      } catch {}
      
      this.emit('certificate_saved');
      
    } catch (error) {
      console.error('[cert-manager] Failed to save certificate:', error);
      throw error;
    }
  }
  
  /**
   * Get certificate file path
   */
  getCertificatePath(type) {
    const filenames = {
      cert: `${this.config.farmId}.crt`,
      key: `${this.config.farmId}.key`,
      ca: 'ca.crt'
    };
    return path.join(this.config.certDir, filenames[type]);
  }
  
  /**
   * Get certificate information
   */
  async getCertificateInfo(certPath) {
    try {
      // Get certificate details using openssl
      const { stdout } = await execAsync(`openssl x509 -in ${certPath} -noout -dates -subject`);
      
      // Parse output
      const lines = stdout.split('\n');
      const notBefore = lines.find(l => l.startsWith('notBefore='))?.split('=')[1];
      const notAfter = lines.find(l => l.startsWith('notAfter='))?.split('=')[1];
      const subject = lines.find(l => l.startsWith('subject='))?.split('=')[1];
      
      const expiryDate = new Date(notAfter);
      const now = new Date();
      const daysUntilExpiry = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      return {
        subject,
        notBefore: new Date(notBefore),
        notAfter: expiryDate,
        daysUntilExpiry,
        valid: daysUntilExpiry > 0
      };
      
    } catch (error) {
      console.error('[cert-manager] Failed to get certificate info:', error);
      return { valid: false, daysUntilExpiry: 0 };
    }
  }
  
  /**
   * Start periodic certificate check
   */
  startCertificateCheck() {
    console.log('[cert-manager] Starting periodic certificate check');
    
    // Check immediately
    this.checkCertificateExpiry();
    
    // Check daily
    this.checkTimer = setInterval(() => {
      this.checkCertificateExpiry();
    }, this.config.checkInterval);
  }
  
  /**
   * Check certificate expiry and renew if needed
   */
  async checkCertificateExpiry() {
    try {
      const certPath = this.getCertificatePath('cert');
      const certInfo = await this.getCertificateInfo(certPath);
      
      console.log(`[cert-manager] Certificate expires in ${certInfo.daysUntilExpiry} days`);
      
      // Emit warning if expiring soon
      if (certInfo.daysUntilExpiry <= this.config.renewBeforeDays && certInfo.daysUntilExpiry > 0) {
        console.warn(`[cert-manager] Certificate expiring in ${certInfo.daysUntilExpiry} days!`);
        this.emit('certificate_expiring', certInfo);
        
        // Auto-renew
        await this.renewCertificate();
      }
      
      // Emit error if expired
      if (certInfo.daysUntilExpiry <= 0) {
        console.error('[cert-manager] Certificate has expired!');
        this.emit('certificate_expired', certInfo);
        
        // Try to renew
        await this.renewCertificate();
      }
      
    } catch (error) {
      console.error('[cert-manager] Certificate check error:', error);
    }
  }
  
  /**
   * Renew certificate
   */
  async renewCertificate() {
    try {
      console.log('[cert-manager] Renewing certificate...');
      
      // Backup existing certificate
      await this.backupCertificate();
      
      // Provision new certificate
      await this.provisionCertificate();
      
      console.log('[cert-manager] Certificate renewed successfully');
      this.emit('certificate_renewed');
      
    } catch (error) {
      console.error('[cert-manager] Certificate renewal failed:', error);
      this.emit('renewal_error', error);
      
      // Restore backup
      await this.restoreCertificate();
      
      throw error;
    }
  }
  
  /**
   * Backup certificate
   */
  async backupCertificate() {
    try {
      const certPath = this.getCertificatePath('cert');
      const keyPath = this.getCertificatePath('key');
      const backupDir = path.join(this.config.certDir, 'backup');
      
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      await fs.copyFile(certPath, path.join(backupDir, `cert-${timestamp}.crt`));
      await fs.copyFile(keyPath, path.join(backupDir, `key-${timestamp}.key`));
      
      console.log('[cert-manager] Certificate backed up');
      
    } catch (error) {
      console.error('[cert-manager] Backup failed:', error);
    }
  }
  
  /**
   * Restore certificate from backup
   */
  async restoreCertificate() {
    try {
      const backupDir = path.join(this.config.certDir, 'backup');
      const files = await fs.readdir(backupDir);
      
      // Get most recent backup
      const certBackups = files.filter(f => f.startsWith('cert-')).sort().reverse();
      const keyBackups = files.filter(f => f.startsWith('key-')).sort().reverse();
      
      if (certBackups.length > 0 && keyBackups.length > 0) {
        const certPath = this.getCertificatePath('cert');
        const keyPath = this.getCertificatePath('key');
        
        await fs.copyFile(path.join(backupDir, certBackups[0]), certPath);
        await fs.copyFile(path.join(backupDir, keyBackups[0]), keyPath);
        
        console.log('[cert-manager] Certificate restored from backup');
        this.emit('certificate_restored');
      }
      
    } catch (error) {
      console.error('[cert-manager] Restore failed:', error);
    }
  }
  
  /**
   * Get TLS options for secure connections
   */
  async getTLSOptions() {
    try {
      const certPath = this.getCertificatePath('cert');
      const keyPath = this.getCertificatePath('key');
      const caPath = this.getCertificatePath('ca');
      
      const cert = await fs.readFile(certPath);
      const key = await fs.readFile(keyPath);
      
      const options = {
        cert,
        key,
        rejectUnauthorized: true
      };
      
      // Add CA certificate if it exists
      try {
        options.ca = await fs.readFile(caPath);
      } catch {}
      
      return options;
      
    } catch (error) {
      console.error('[cert-manager] Failed to get TLS options:', error);
      throw error;
    }
  }
  
  /**
   * Verify certificate is valid
   */
  async verifyCertificate() {
    try {
      const certPath = this.getCertificatePath('cert');
      
      // Verify certificate using openssl
      await execAsync(`openssl x509 -in ${certPath} -noout -text`);
      
      console.log('[cert-manager] Certificate verified successfully');
      return true;
      
    } catch (error) {
      console.error('[cert-manager] Certificate verification failed:', error);
      return false;
    }
  }
  
  /**
   * Stop certificate manager
   */
  stop() {
    console.log('[cert-manager] Stopping certificate manager...');
    
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    console.log('[cert-manager] Certificate manager stopped');
    this.emit('stopped');
  }
}
