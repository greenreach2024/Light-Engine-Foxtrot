import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class Logger {
    private logFile: string;

    constructor(extensionPath: string) {
        this.logFile = path.join(extensionPath, 'logs', 'workflow.log');
    }

    async init() {
        const logDir = path.dirname(this.logFile);
        await fs.mkdir(logDir, { recursive: true });
    }

    async log(level: 'info' | 'warn' | 'error', message: string, data?: any) {
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
        } catch (e) {
            console.error('Failed to write log:', e);
        }
    }

    async info(message: string, data?: any) {
        await this.log('info', message, data);
    }

    async warn(message: string, data?: any) {
        await this.log('warn', message, data);
    }

    async error(message: string, data?: any) {
        await this.log('error', message, data);
    }

    async getRecentLogs(count: number = 50): Promise<string[]> {
        try {
            const content = await fs.readFile(this.logFile, 'utf-8');
            const lines = content.trim().split('\n');
            return lines.slice(-count);
        } catch (e) {
            return [];
        }
    }
}
