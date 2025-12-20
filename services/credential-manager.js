/**
 * Credential Manager Service
 * 
 * Securely stores and manages API credentials, certificates, and sensitive configuration.
 * Uses OS keyring/keychain when available, falls back to encrypted file storage.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import EventEmitter from 'events';

const execAsync = promisify(exec);

export default class CredentialManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      storageDir: config.storageDir || process.env.CREDENTIALS_DIR || '/etc/greenreach/credentials',
      masterKeyPath: config.masterKeyPath || '/etc/greenreach/master.key',
      algorithm: 'aes-256-gcm',
      keyLength: 32,
      ivLength: 16,
      saltLength: 64,
      tagLength: 16,
      ...config
    };
    
    this.masterKey = null;
    this.cache = new Map();
  }
  
  /**
   * Initialize credential manager
   */
  async initialize() {
    console.log('[credential-manager] Initializing credential manager...');
    
    // Ensure storage directory exists
    await this.ensureStorageDirectory();
    
    // Load or generate master key
    await this.loadMasterKey();
    
    console.log('[credential-manager] Credential manager initialized');
    this.emit('initialized');
  }
  
  /**
   * Ensure storage directory exists
   */
  async ensureStorageDirectory() {
    try {
      await fs.mkdir(this.config.storageDir, { recursive: true, mode: 0o700 });
      console.log('[credential-manager] Storage directory ready:', this.config.storageDir);
    } catch (error) {
      console.error('[credential-manager] Failed to create storage directory:', error);
      throw error;
    }
  }
  
  /**
   * Load or generate master key
   */
  async loadMasterKey() {
    try {
      // Try to load existing master key
      const keyData = await fs.readFile(this.config.masterKeyPath);
      this.masterKey = keyData;
      console.log('[credential-manager] Master key loaded');
      
    } catch (error) {
      // Generate new master key
      console.log('[credential-manager] Generating new master key...');
      this.masterKey = crypto.randomBytes(this.config.keyLength);
      
      // Save master key
      await fs.writeFile(this.config.masterKeyPath, this.masterKey, { mode: 0o600 });
      console.log('[credential-manager] Master key saved:', this.config.masterKeyPath);
    }
  }
  
  /**
   * Store credential securely
   */
  async setCredential(key, value, metadata = {}) {
    try {
      console.log(`[credential-manager] Storing credential: ${key}`);
      
      // Encrypt value
      const encrypted = this.encrypt(value);
      
      // Prepare credential object
      const credential = {
        key,
        encrypted,
        metadata: {
          ...metadata,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
      
      // Save to file
      const filePath = this.getCredentialPath(key);
      await fs.writeFile(filePath, JSON.stringify(credential), { mode: 0o600 });
      
      // Update cache
      this.cache.set(key, value);
      
      console.log(`[credential-manager] Credential stored: ${key}`);
      this.emit('credential_stored', { key, metadata });
      
    } catch (error) {
      console.error(`[credential-manager] Failed to store credential ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Retrieve credential
   */
  async getCredential(key) {
    try {
      // Check cache first
      if (this.cache.has(key)) {
        return this.cache.get(key);
      }
      
      // Load from file
      const filePath = this.getCredentialPath(key);
      const data = await fs.readFile(filePath, 'utf8');
      const credential = JSON.parse(data);
      
      // Decrypt value
      const value = this.decrypt(credential.encrypted);
      
      // Update cache
      this.cache.set(key, value);
      
      return value;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // Credential not found
      }
      console.error(`[credential-manager] Failed to get credential ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete credential
   */
  async deleteCredential(key) {
    try {
      console.log(`[credential-manager] Deleting credential: ${key}`);
      
      const filePath = this.getCredentialPath(key);
      await fs.unlink(filePath);
      
      // Remove from cache
      this.cache.delete(key);
      
      console.log(`[credential-manager] Credential deleted: ${key}`);
      this.emit('credential_deleted', { key });
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[credential-manager] Failed to delete credential ${key}:`, error);
        throw error;
      }
    }
  }
  
  /**
   * List all stored credentials
   */
  async listCredentials() {
    try {
      const files = await fs.readdir(this.config.storageDir);
      const credentials = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.config.storageDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const credential = JSON.parse(data);
          
          credentials.push({
            key: credential.key,
            metadata: credential.metadata
          });
        }
      }
      
      return credentials;
      
    } catch (error) {
      console.error('[credential-manager] Failed to list credentials:', error);
      throw error;
    }
  }
  
  /**
   * Rotate credential
   */
  async rotateCredential(key, newValue, metadata = {}) {
    try {
      console.log(`[credential-manager] Rotating credential: ${key}`);
      
      // Get old value for backup
      const oldValue = await this.getCredential(key);
      
      // Store old value as backup
      if (oldValue) {
        const backupKey = `${key}.backup.${Date.now()}`;
        await this.setCredential(backupKey, oldValue, {
          ...metadata,
          rotatedFrom: key,
          rotatedAt: new Date().toISOString()
        });
      }
      
      // Store new value
      await this.setCredential(key, newValue, {
        ...metadata,
        rotated: true
      });
      
      console.log(`[credential-manager] Credential rotated: ${key}`);
      this.emit('credential_rotated', { key, metadata });
      
    } catch (error) {
      console.error(`[credential-manager] Failed to rotate credential ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Encrypt data
   */
  encrypt(data) {
    try {
      // Generate IV (Initialization Vector)
      const iv = crypto.randomBytes(this.config.ivLength);
      
      // Create cipher
      const cipher = crypto.createCipheriv(
        this.config.algorithm,
        this.masterKey,
        iv
      );
      
      // Encrypt data
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get auth tag
      const tag = cipher.getAuthTag();
      
      // Return encrypted data with IV and tag
      return {
        iv: iv.toString('hex'),
        encrypted: encrypted,
        tag: tag.toString('hex')
      };
      
    } catch (error) {
      console.error('[credential-manager] Encryption failed:', error);
      throw error;
    }
  }
  
  /**
   * Decrypt data
   */
  decrypt(encryptedData) {
    try {
      // Extract IV, tag, and encrypted data
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const tag = Buffer.from(encryptedData.tag, 'hex');
      
      // Create decipher
      const decipher = crypto.createDecipheriv(
        this.config.algorithm,
        this.masterKey,
        iv
      );
      
      // Set auth tag
      decipher.setAuthTag(tag);
      
      // Decrypt data
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      // Try to parse as JSON, otherwise return as string
      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
      
    } catch (error) {
      console.error('[credential-manager] Decryption failed:', error);
      throw error;
    }
  }
  
  /**
   * Get credential file path
   */
  getCredentialPath(key) {
    // Hash key to create safe filename
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.config.storageDir, `${hash}.json`);
  }
  
  /**
   * Export credentials (encrypted)
   */
  async exportCredentials(password) {
    try {
      console.log('[credential-manager] Exporting credentials...');
      
      const credentials = await this.listCredentials();
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        credentials: []
      };
      
      // Get all credential values
      for (const cred of credentials) {
        const value = await this.getCredential(cred.key);
        exportData.credentials.push({
          key: cred.key,
          value,
          metadata: cred.metadata
        });
      }
      
      // Encrypt export with password
      const salt = crypto.randomBytes(this.config.saltLength);
      const key = crypto.pbkdf2Sync(password, salt, 100000, this.config.keyLength, 'sha256');
      
      const iv = crypto.randomBytes(this.config.ivLength);
      const cipher = crypto.createCipheriv(this.config.algorithm, key, iv);
      
      let encrypted = cipher.update(JSON.stringify(exportData), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      const exportPackage = {
        version: '1.0',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        encrypted
      };
      
      console.log('[credential-manager] Credentials exported');
      this.emit('credentials_exported');
      
      return exportPackage;
      
    } catch (error) {
      console.error('[credential-manager] Export failed:', error);
      throw error;
    }
  }
  
  /**
   * Import credentials (encrypted)
   */
  async importCredentials(exportPackage, password) {
    try {
      console.log('[credential-manager] Importing credentials...');
      
      // Derive key from password
      const salt = Buffer.from(exportPackage.salt, 'hex');
      const key = crypto.pbkdf2Sync(password, salt, 100000, this.config.keyLength, 'sha256');
      
      // Decrypt export
      const iv = Buffer.from(exportPackage.iv, 'hex');
      const tag = Buffer.from(exportPackage.tag, 'hex');
      
      const decipher = crypto.createDecipheriv(this.config.algorithm, key, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(exportPackage.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const exportData = JSON.parse(decrypted);
      
      // Import credentials
      for (const cred of exportData.credentials) {
        await this.setCredential(cred.key, cred.value, {
          ...cred.metadata,
          importedAt: new Date().toISOString()
        });
      }
      
      console.log(`[credential-manager] Imported ${exportData.credentials.length} credentials`);
      this.emit('credentials_imported', { count: exportData.credentials.length });
      
    } catch (error) {
      console.error('[credential-manager] Import failed:', error);
      throw error;
    }
  }
  
  /**
   * Backup credentials
   */
  async backupCredentials() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.config.storageDir, 'backups');
      
      await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
      
      const credentials = await this.listCredentials();
      const backupData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        credentials: []
      };
      
      for (const cred of credentials) {
        const filePath = this.getCredentialPath(cred.key);
        const data = await fs.readFile(filePath, 'utf8');
        backupData.credentials.push(JSON.parse(data));
      }
      
      const backupPath = path.join(backupDir, `backup-${timestamp}.json`);
      await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2), { mode: 0o600 });
      
      console.log('[credential-manager] Credentials backed up:', backupPath);
      this.emit('credentials_backed_up', { path: backupPath });
      
      return backupPath;
      
    } catch (error) {
      console.error('[credential-manager] Backup failed:', error);
      throw error;
    }
  }
  
  /**
   * Verify credential integrity
   */
  async verifyCredential(key) {
    try {
      const value = await this.getCredential(key);
      return value !== null;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('[credential-manager] Cache cleared');
  }
  
  /**
   * Get credential metadata
   */
  async getCredentialMetadata(key) {
    try {
      const filePath = this.getCredentialPath(key);
      const data = await fs.readFile(filePath, 'utf8');
      const credential = JSON.parse(data);
      
      return credential.metadata;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
