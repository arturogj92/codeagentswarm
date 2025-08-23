#!/usr/bin/env node

// Script para verificar el estado de los hooks y probar el webhook

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// Colores para la terminal
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

console.log(`${colors.cyan}=== CodeAgentSwarm Hooks Test ===${colors.reset}\n`);

// 1. Verificar si existe el archivo de settings
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
console.log(`${colors.blue}1. Checking Claude settings file...${colors.reset}`);
console.log(`   Path: ${settingsPath}`);

if (fs.existsSync(settingsPath)) {
    console.log(`   ${colors.green}✓ Settings file exists${colors.reset}`);
    
    // Leer y mostrar los hooks
    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        console.log(`\n${colors.blue}2. Installed hooks:${colors.reset}`);
        
        if (settings.hooks) {
            // Verificar hook de Notification
            if (settings.hooks.Notification && settings.hooks.Notification['*']) {
                console.log(`   ${colors.green}✓ Notification hook installed${colors.reset}`);
                const notifHooks = settings.hooks.Notification['*'];
                const codeAgentHook = Array.isArray(notifHooks) 
                    ? notifHooks.find(h => h.command && h.command.includes('localhost:45782'))
                    : (notifHooks.command && notifHooks.command.includes('localhost:45782') ? notifHooks : null);
                
                if (codeAgentHook) {
                    console.log(`     - Webhook URL: http://localhost:45782/webhook`);
                    console.log(`     - Event: confirmation_needed`);
                }
            } else {
                console.log(`   ${colors.red}✗ Notification hook not found${colors.reset}`);
            }
            
            // Verificar hook de Stop
            if (settings.hooks.Stop) {
                console.log(`   ${colors.green}✓ Stop hook installed${colors.reset}`);
                const stopHooks = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [settings.hooks.Stop];
                const codeAgentHook = stopHooks.find(h => h.command && h.command.includes('localhost:45782'));
                
                if (codeAgentHook) {
                    console.log(`     - Webhook URL: http://localhost:45782/webhook`);
                    console.log(`     - Event: claude_finished`);
                }
            } else {
                console.log(`   ${colors.red}✗ Stop hook not found${colors.reset}`);
            }
        } else {
            console.log(`   ${colors.red}✗ No hooks found in settings${colors.reset}`);
        }
    } catch (error) {
        console.log(`   ${colors.red}✗ Error reading settings: ${error.message}${colors.reset}`);
    }
} else {
    console.log(`   ${colors.red}✗ Settings file does not exist${colors.reset}`);
    console.log(`   ${colors.yellow}Run CodeAgentSwarm to create it automatically${colors.reset}`);
}

// 2. Verificar el webhook server
console.log(`\n${colors.blue}3. Testing webhook server...${colors.reset}`);

function testWebhook(eventType, terminalId = 1) {
    return new Promise((resolve) => {
        const data = JSON.stringify({
            event: eventType,
            terminal: terminalId.toString(),
            tool: eventType === 'confirmation_needed' ? 'Edit' : undefined,
            session_id: 'test-session-' + Date.now()
        });

        const options = {
            hostname: 'localhost',
            port: 45782,
            path: '/webhook',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log(`   ${colors.green}✓ ${eventType} webhook test successful${colors.reset}`);
                    resolve(true);
                } else {
                    console.log(`   ${colors.red}✗ ${eventType} webhook test failed: ${res.statusCode}${colors.reset}`);
                    resolve(false);
                }
            });
        });

        req.on('error', (error) => {
            if (error.code === 'ECONNREFUSED') {
                console.log(`   ${colors.red}✗ Webhook server not running (port 45782)${colors.reset}`);
                console.log(`   ${colors.yellow}Make sure CodeAgentSwarm is running${colors.reset}`);
            } else {
                console.log(`   ${colors.red}✗ Error: ${error.message}${colors.reset}`);
            }
            resolve(false);
        });

        req.write(data);
        req.end();
    });
}

// Probar ambos tipos de eventos
async function runTests() {
    // Primero verificar si el servidor está corriendo
    const healthCheck = await new Promise((resolve) => {
        http.get('http://localhost:45782/health', (res) => {
            if (res.statusCode === 200) {
                console.log(`   ${colors.green}✓ Webhook server is running${colors.reset}`);
                resolve(true);
            } else {
                resolve(false);
            }
        }).on('error', () => {
            resolve(false);
        });
    });

    if (healthCheck) {
        console.log(`\n${colors.blue}4. Sending test events...${colors.reset}`);
        await testWebhook('confirmation_needed', 1);
        await testWebhook('claude_finished', 2);
        
        console.log(`\n${colors.yellow}Check CodeAgentSwarm for notifications!${colors.reset}`);
    }
}

// Mostrar cómo simular manualmente un evento
console.log(`\n${colors.blue}5. Manual test commands:${colors.reset}`);
console.log(`   To simulate a confirmation needed event:`);
console.log(`   ${colors.cyan}curl -X POST http://localhost:45782/webhook -H "Content-Type: application/json" -d '{"event":"confirmation_needed","terminal":"1","tool":"Edit"}'${colors.reset}`);
console.log(`\n   To simulate Claude finished event:`);
console.log(`   ${colors.cyan}curl -X POST http://localhost:45782/webhook -H "Content-Type: application/json" -d '{"event":"claude_finished","terminal":"1"}'${colors.reset}`);

// Ejecutar las pruebas
runTests().then(() => {
    console.log(`\n${colors.cyan}=== Test Complete ===${colors.reset}`);
});