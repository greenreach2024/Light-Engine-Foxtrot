"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class Logger {
    constructor(extensionPath) {
        this.logFile = path.join(extensionPath, 'logs', 'workflow.log');
    }
    async init() {
        const logDir = path.dirname(this.logFile);
        await fs.mkdir(logDir, { recursive: true });
    }
    async log(level, message, data) {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level,
            message,
            data
        };
        const line = JSON.stringify(entry) + '\n';
        try {
            await fs.appendFile(this.logFile, line);
        }
        catch (e) {
            console.error('Failed to write log:', e);
        }
    }
    async info(message, data) {
        await this.log('info', message, data);
    }
    async warn(message, data) {
        await this.log('warn', message, data);
    }
    async error(message, data) {
        await this.log('error', message, data);
    }
    async getRecentLogs(count = 50) {
        try {
            const content = await fs.readFile(this.logFile, 'utf-8');
            const lines = content.trim().split('\n');
            return lines.slice(-count);
        }
        catch (e) {
            return [];
        }
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map