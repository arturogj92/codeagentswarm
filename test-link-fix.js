// Test script to verify link click debouncing
const { app, BrowserWindow, shell } = require('electron');

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Create a simple HTML page with links
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Link Click Test</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                a { display: block; margin: 10px 0; color: blue; }
                .status { margin-top: 20px; color: green; }
            </style>
        </head>
        <body>
            <h1>Link Click Test</h1>
            <p>Try double-clicking these links rapidly:</p>
            
            <a href="https://github.com" target="_blank">GitHub (external link)</a>
            <a href="https://google.com" target="_blank">Google (external link)</a>
            
            <div id="terminal-link-test" style="background: #000; color: #0f0; padding: 10px; margin-top: 20px;">
                Terminal simulation with link: https://example.com
            </div>
            
            <div class="status" id="status">Status: Ready</div>
            
            <script>
                const { shell } = require('electron');
                let clickCount = 0;
                let lastClickTime = 0;
                
                // Track all clicks
                document.addEventListener('click', (e) => {
                    const now = Date.now();
                    const timeDiff = now - lastClickTime;
                    lastClickTime = now;
                    clickCount++;
                    
                    document.getElementById('status').textContent = 
                        \`Click #\${clickCount} - Time since last: \${timeDiff}ms\`;
                });
                
                // Debounced link handler
                let linkTimeouts = new Map();
                let linkLastClicks = new Map();
                
                document.querySelectorAll('a[target="_blank"]').forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        const href = link.href;
                        const now = Date.now();
                        const lastClick = linkLastClicks.get(href) || 0;
                        
                        if (now - lastClick < 300) {
                            console.log('Ignoring rapid click on:', href);
                            return;
                        }
                        
                        if (linkTimeouts.has(href)) {
                            clearTimeout(linkTimeouts.get(href));
                        }
                        
                        const timeout = setTimeout(() => {
                            console.log('Opening:', href);
                            shell.openExternal(href);
                            linkTimeouts.delete(href);
                        }, 50);
                        
                        linkTimeouts.set(href, timeout);
                        linkLastClicks.set(href, now);
                    });
                });
            </script>
        </body>
        </html>
    `;

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});

app.on('window-all-closed', () => {
    app.quit();
});