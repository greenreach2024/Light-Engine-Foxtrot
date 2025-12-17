import path from 'path';
import { appendNdjsonLine, ensureDirSync } from './utils/file-storage.js';

export default class AutomationLogger {
  constructor(options = {}) {
    const {
      dataDir = path.resolve('./data/automation'),
      fileName = 'events.ndjson'
    } = options;

    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, fileName);
    this.memoryBuffer = []; // Keep last 100 events in memory
    this.maxBufferSize = 100;
    ensureDirSync(this.dataDir);
  }

  log(event) {
    const payload = {
      ts: event?.ts || Date.now(),
      timestamp: event?.timestamp || new Date(event?.ts || Date.now()).toISOString(),
      ...event
    };
    appendNdjsonLine(this.filePath, payload);
    
    // Add to memory buffer
    this.memoryBuffer.push(payload);
    if (this.memoryBuffer.length > this.maxBufferSize) {
      this.memoryBuffer.shift(); // Remove oldest
    }
    
    return payload;
  }

  getHistory(limit = 100) {
    // Return most recent events from memory buffer
    const count = Math.min(limit, this.memoryBuffer.length);
    return this.memoryBuffer.slice(-count);
  }

  clearHistory() {
    this.memoryBuffer = [];
  }
}
