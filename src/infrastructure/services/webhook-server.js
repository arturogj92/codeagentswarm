const express = require('express');
const bodyParser = require('body-parser');
const { Notification } = require('electron');
const path = require('path');

// Initialize child process logger
const ChildProcessLogger = require('../../shared/logger/child-process-logger');
const childLogger = new ChildProcessLogger('Webhook-Server');

class WebhookServer {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.app = express();
        this.port = 45782;
        this.server = null;
        this.isRunning = false;
        
        // Track recent events to prevent duplicates
        this.recentEvents = new Map();
        this.eventDedupeWindow = 2000; // 2 seconds
        
        // Track recent confirmations to suppress finished notifications
        this.recentConfirmations = new Map();
        this.confirmationSuppressionWindow = 5000; // 5 seconds
        
        // Track recent completed notifications to suppress confirmation notifications
        this.recentCompletedNotifications = new Map();
        this.completedSuppressionWindow = 5000; // 5 seconds
        
        // Track recent notifications to prevent spam
        this.recentNotifications = new Map();
        this.notificationCooldown = 10000; // 10 seconds between same notifications
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Parse JSON bodies
        this.app.use(bodyParser.json());
        
    }

    setupRoutes() {
        // Main webhook endpoint
        this.app.post('/webhook', (req, res) => {
            try {
                const { type, terminalId, tool } = req.body;
                
                // Temporary debug log to see what's coming in
                if (type === 'claude_finished' && tool) {
                    console.log('[Webhook Debug] Stop hook received unexpected tool parameter:', tool);
                }
                
                // Create event key for deduplication
                const eventKey = `${type}-${terminalId}-${tool || ''}`;
                const now = Date.now();
                
                // Check if this is a duplicate event
                const lastEventTime = this.recentEvents.get(eventKey);
                if (lastEventTime && (now - lastEventTime) < this.eventDedupeWindow) {
                    res.json({ success: true, duplicate: true });
                    return;
                }
                
                // Record this event
                this.recentEvents.set(eventKey, now);
                
                // Clean up old events
                for (const [key, time] of this.recentEvents.entries()) {
                    if (now - time > this.eventDedupeWindow * 2) {
                        this.recentEvents.delete(key);
                    }
                }
                
                
                switch (type) {
                    case 'confirmation_needed':
                        this.handleConfirmationNeeded(terminalId, tool);
                        break;
                    case 'claude_finished':
                        // Make sure we're not accidentally passing tool to claude_finished
                        this.handleClaudeFinished(terminalId);
                        break;
                    default:
                        console.log('[Webhook] Unknown event type:', type);
                }
                
                res.json({ success: true });
            } catch (error) {
                console.error('[Webhook] Error handling webhook:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                service: 'CodeAgentSwarm Webhook Server',
                uptime: process.uptime()
            });
        });
    }

    handleConfirmationNeeded(terminalId, tool) {
        
        // Terminal ID comes as 1-based from the environment variable
        const terminalNum = parseInt(terminalId) || 1;
        // Convert to 0-based for internal use
        const terminalIndex = terminalNum - 1;
        
        // Record this confirmation for suppression logic
        const now = Date.now();
        this.recentConfirmations.set(terminalNum, now);
        
        // Clean up old confirmations
        for (const [terminal, time] of this.recentConfirmations.entries()) {
            if (now - time > this.confirmationSuppressionWindow * 2) {
                this.recentConfirmations.delete(terminal);
            }
        }
        
        // Clean up old completed notification records
        for (const [terminal, time] of this.recentCompletedNotifications.entries()) {
            if (now - time > this.completedSuppressionWindow * 2) {
                this.recentCompletedNotifications.delete(terminal);
            }
        }
        
        // Send to renderer process (expects 0-based index)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('confirmation-needed', {
                terminalId: terminalIndex,
                tool: tool || 'unknown'
            });
        }
        
        // Check if we recently showed a "completed" notification for this terminal
        const lastCompletedTime = this.recentCompletedNotifications.get(terminalNum);
        const hadRecentCompleted = lastCompletedTime && 
            (now - lastCompletedTime) < this.completedSuppressionWindow;
        
        // Skip notification if we just showed a "completed" notification
        if (hadRecentCompleted) {
            console.log(`[Webhook] Suppressed 'confirmation' notification for Terminal ${terminalNum} (just showed 'completed' ${Math.round((now - lastCompletedTime) / 1000)}s ago)`);
            return;
        }
        
        // Check if we should show notification (rate limiting)
        const notifKey = `confirmation-${terminalNum}`;
        const lastNotifTime = this.recentNotifications.get(notifKey);
        
        if (!lastNotifTime || (now - lastNotifTime) > this.notificationCooldown) {
            // Show system notification (display 1-based)
            const notification = new Notification({
                title: 'Terminal needs confirmation',
                body: `Terminal ${terminalNum}`,
                icon: path.join(__dirname, '..', '..', '..', 'assets', 'icons', 'logo_prod_512.png'),
                silent: false
            });
            
            notification.on('click', () => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.show();
                    this.mainWindow.focus();
                }
            });
            
            notification.show();
            
            // Record notification time
            this.recentNotifications.set(notifKey, now);
            
            // Clean up old notification records
            for (const [key, time] of this.recentNotifications.entries()) {
                if (now - time > this.notificationCooldown * 2) {
                    this.recentNotifications.delete(key);
                }
            }
        } else {
            console.log(`[Webhook] Suppressing duplicate notification for terminal ${terminalNum} (cooldown active)`);
        }
    }

    handleClaudeFinished(terminalId) {
        
        // Terminal ID comes as 1-based from the environment variable
        const terminalNum = parseInt(terminalId) || 1;
        // Convert to 0-based for internal use
        const terminalIndex = terminalNum - 1;
        
        // Send to renderer process (expects 0-based index) - always send this
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('claude-finished', {
                terminalId: terminalIndex
            });
        }
        
        // Check if there was a recent confirmation for this terminal
        const lastConfirmationTime = this.recentConfirmations.get(terminalNum);
        const now = Date.now();
        const hadRecentConfirmation = lastConfirmationTime && 
            (now - lastConfirmationTime) < this.confirmationSuppressionWindow;
        
        // Skip notification if we had a recent confirmation
        if (hadRecentConfirmation) {
            console.log(`[Webhook] Suppressed 'finished' notification for Terminal ${terminalNum} (had confirmation ${Math.round((now - lastConfirmationTime) / 1000)}s ago)`);
            return;
        }
        
        // Check if we should show notification (rate limiting)
        const notifKey = `finished-${terminalNum}`;
        const lastNotifTime = this.recentNotifications.get(notifKey);
        
        if (!lastNotifTime || (now - lastNotifTime) > this.notificationCooldown) {
            // Show system notification (display 1-based)
            const notification = new Notification({
                title: 'Terminal finished',
                body: `Terminal ${terminalNum} has completed`,
                icon: path.join(__dirname, '..', '..', '..', 'assets', 'icons', 'logo_prod_512.png'),
                silent: false
            });
            
            notification.on('click', () => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.show();
                    this.mainWindow.focus();
                }
            });
            
            notification.show();
            
            // Record notification time
            this.recentNotifications.set(notifKey, now);
            
            // Record that we showed a "completed" notification for this terminal
            this.recentCompletedNotifications.set(terminalNum, now);
            
            // Clean up old notification records
            for (const [key, time] of this.recentNotifications.entries()) {
                if (now - time > this.notificationCooldown * 2) {
                    this.recentNotifications.delete(key);
                }
            }
            
            // Clean up old completed notification records
            for (const [terminal, time] of this.recentCompletedNotifications.entries()) {
                if (now - time > this.completedSuppressionWindow * 2) {
                    this.recentCompletedNotifications.delete(terminal);
                }
            }
        } else {
            console.log(`[Webhook] Suppressing duplicate notification for terminal ${terminalNum} finished (cooldown active)`);
        }
    }

    async start() {
        if (this.isRunning) {
            return { success: true, port: this.port };
        }
        
        return new Promise((resolve) => {
            try {
                this.server = this.app.listen(this.port, () => {
                    this.isRunning = true;
                    console.log(`[Webhook] Server started on port ${this.port}`);
                    resolve({ success: true, port: this.port });
                });
                
                this.server.on('error', (error) => {
                    console.error('[Webhook] Server error:', error);
                    this.isRunning = false;
                    
                    if (error.code === 'EADDRINUSE') {
                        resolve({ success: false, error: `Port ${this.port} is already in use` });
                    } else {
                        resolve({ success: false, error: error.message });
                    }
                });
            } catch (error) {
                resolve({ success: false, error: error.message });
            }
        });
    }

    async stop() {
        if (!this.isRunning || !this.server) {
            return { success: true };
        }
        
        return new Promise((resolve) => {
            this.server.close((error) => {
                if (error) {
                    console.error('[Webhook] Error stopping server:', error);
                    resolve({ success: false, error: error.message });
                } else {
                    this.isRunning = false;
                    console.log('[Webhook] Server stopped');
                    resolve({ success: true });
                }
            });
        });
    }

    getStatus() {
        return {
            running: this.isRunning,
            port: this.port
        };
    }
}

module.exports = WebhookServer;