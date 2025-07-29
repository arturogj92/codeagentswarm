# Plan Completo: Sistema de Actualizaciones y Logs para CodeAgentSwarm

## 🎯 OBJETIVO
Implementar un sistema robusto que permita:
- Actualizaciones remotas automáticas sin intervención del usuario
- Modelo freemium con diferentes canales de actualización
- **Recolección y envío de logs/crash reports por parte del usuario**
- Proceso automatizado de publicación de releases

## ✅ CONFIRMACIÓN: Sí, esto es todo lo que necesitas

El plan incluye:

### 1. **Sistema de Actualizaciones Automáticas**
- ✅ electron-updater integrado en la app
- ✅ Servidor Node.js en Railway que sirve las actualizaciones
- ✅ Control de versiones por tipo de licencia (free/premium)
- ✅ UI moderna para notificar actualizaciones

### 2. **Sistema de Logs y Soporte**
- ✅ **Botón "Enviar logs" en el menú de la app**
- ✅ **Captura automática de crashes**
- ✅ **Endpoints en el servidor para recibir logs**
- ✅ **Sistema de tickets con ID de soporte (ej: SUP-ABC123)**
- ✅ **Panel admin para revisar logs de usuarios**

### 3. **Infraestructura**
- ✅ Railway para el servidor Node.js ($5/mes)
- ✅ Supabase para base de datos y storage (gratis inicialmente)
- ✅ GitHub Actions para CI/CD automático
- ✅ Sentry opcional para monitoreo avanzado

## 📋 FASE 1: Configuración de electron-updater

### 1.1 Instalación
```bash
npm install --save electron-updater electron-log electron-store
npm install --save-dev @sentry/electron
```

### 1.2 Crear servicio de actualizaciones
```javascript
// services/updater-service.js
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { dialog } = require('electron');

class UpdaterService {
  constructor() {
    // Configurar logs
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    
    // Configurar servidor
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: process.env.UPDATE_SERVER_URL || 'https://tu-app.railway.app/update',
      headers: {
        'Authorization': `Bearer ${this.getLicenseToken()}`
      }
    });
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      log.info('Buscando actualizaciones...');
    });
    
    autoUpdater.on('update-available', (info) => {
      log.info('Actualización disponible:', info.version);
      this.notifyUpdateAvailable(info);
    });
    
    autoUpdater.on('update-not-available', () => {
      log.info('No hay actualizaciones disponibles');
    });
    
    autoUpdater.on('error', (err) => {
      log.error('Error en actualización:', err);
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
      const logMessage = `Descarga: ${Math.round(progressObj.percent)}% - Velocidad: ${progressObj.bytesPerSecond}`;
      log.info(logMessage);
      // Enviar progreso a la UI
      this.sendToRenderer('update-progress', progressObj);
    });
    
    autoUpdater.on('update-downloaded', () => {
      this.notifyUpdateReady();
    });
  }
  
  async checkForUpdates() {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      log.error('Error checking for updates:', error);
    }
  }
  
  notifyUpdateAvailable(info) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Actualización disponible',
      message: `Nueva versión ${info.version} está disponible`,
      detail: 'Se descargará en segundo plano.',
      buttons: ['OK']
    });
  }
  
  notifyUpdateReady() {
    const response = dialog.showMessageBoxSync({
      type: 'info',
      title: 'Actualización lista',
      message: 'La actualización se ha descargado',
      detail: '¿Deseas reiniciar ahora para aplicar la actualización?',
      buttons: ['Reiniciar', 'Más tarde']
    });
    
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  }
  
  getLicenseToken() {
    const Store = require('electron-store');
    const store = new Store();
    return store.get('licenseToken', '');
  }
  
  sendToRenderer(channel, data) {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send(channel, data);
    });
  }
}

module.exports = UpdaterService;
```

## 📋 FASE 2: Servidor Node.js en Railway

### 2.1 Estructura del servidor
```
update-server/
├── src/
│   ├── index.js
│   ├── routes/
│   │   ├── updates.js      # Endpoints de actualización
│   │   ├── logs.js         # Endpoints para recibir logs
│   │   └── support.js      # Endpoints de soporte
│   ├── middleware/
│   │   ├── auth.js
│   │   └── rateLimit.js
│   ├── services/
│   │   ├── supabase.js
│   │   ├── version.js
│   │   └── logProcessor.js
│   └── utils/
│       └── yaml.js
├── package.json
└── .env.example
```

### 2.2 Servidor principal
```javascript
// update-server/src/index.js
const express = require('express');
const cors = require('cors');
const compression = require('compression');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/update', require('./routes/updates'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/support', require('./routes/support'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Update server running on port ${PORT}`);
});
```

### 2.3 Rutas de actualización
```javascript
// update-server/src/routes/updates.js
const express = require('express');
const router = express.Router();
const yaml = require('js-yaml');
const { checkLicense } = require('../middleware/auth');
const { getLatestVersion } = require('../services/version');

// Endpoint principal: /update/:platform/latest.yml
router.get('/:platform/latest.yml', checkLicense, async (req, res) => {
  try {
    const { platform } = req.params;
    const { licenseType } = req;
    
    // Obtener versión según tipo de licencia
    const version = await getLatestVersion(platform, licenseType);
    
    if (!version) {
      return res.status(404).send('No updates available');
    }
    
    // Generar YAML de respuesta
    const updateInfo = {
      version: version.version,
      files: [{
        url: version.downloadUrl,
        sha512: version.sha512,
        size: version.fileSize
      }],
      path: version.downloadUrl,
      sha512: version.sha512,
      releaseDate: version.releaseDate
    };
    
    res.set('Content-Type', 'text/yaml');
    res.send(yaml.dump(updateInfo));
  } catch (error) {
    console.error('Error serving update:', error);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;
```

### 2.4 Rutas para logs y soporte
```javascript
// update-server/src/routes/logs.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { generateSupportId } = require('../utils/support');

// Recibir bundle de logs del usuario
router.post('/bundle', async (req, res) => {
  try {
    const {
      logs,
      systemInfo,
      appVersion,
      licenseId,
      userDescription
    } = req.body;
    
    // Generar ID de soporte único
    const supportId = generateSupportId();
    
    // Guardar en Supabase
    const { data, error } = await supabase
      .from('log_bundles')
      .insert({
        support_id: supportId,
        license_id: licenseId,
        app_version: appVersion,
        platform: systemInfo.platform,
        log_data: logs.length < 1000000 ? logs : null, // Si es pequeño, guardar en DB
        log_file_path: logs.length >= 1000000 ? await uploadLargeLog(logs, supportId) : null,
        system_info: systemInfo,
        user_description: userDescription,
        status: 'new'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      supportId: supportId,
      message: 'Logs recibidos correctamente'
    });
    
  } catch (error) {
    console.error('Error processing log bundle:', error);
    res.status(500).json({ error: 'Error al procesar los logs' });
  }
});

// Recibir errores individuales
router.post('/error', async (req, res) => {
  try {
    const { error: dbError } = await supabase
      .from('error_logs')
      .insert(req.body);
    
    if (dbError) throw dbError;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving error log:', error);
    res.status(500).json({ error: 'Failed to save error log' });
  }
});

// Recibir crash reports
router.post('/crash', async (req, res) => {
  try {
    const crashData = req.body;
    
    // Procesar minidump si existe
    if (crashData.minidump) {
      crashData.minidump_path = await uploadMinidump(crashData.minidump);
    }
    
    await supabase
      .from('crash_reports')
      .insert(crashData);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error processing crash report:', error);
    res.status(500).json({ error: 'Failed to process crash report' });
  }
});

module.exports = router;
```

## 📋 FASE 3: Sistema de envío de logs en la app

### 3.1 Servicio de reporte de logs
```javascript
// services/log-reporter.js
const { app, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const Store = require('electron-store');

class LogReporter {
  constructor() {
    this.store = new Store();
    this.serverUrl = process.env.UPDATE_SERVER_URL || 'https://tu-app.railway.app';
  }
  
  async collectSystemInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      osVersion: require('os').release(),
      totalMemory: require('os').totalmem(),
      freeMemory: require('os').freemem(),
      cpus: require('os').cpus().length
    };
  }
  
  async collectLogs() {
    const logPath = path.join(app.getPath('userData'), 'logs');
    const logs = [];
    
    try {
      const files = await fs.readdir(logPath);
      const recentFiles = files
        .filter(f => f.endsWith('.log'))
        .slice(-5); // Últimos 5 archivos
      
      for (const file of recentFiles) {
        const content = await fs.readFile(path.join(logPath, file), 'utf8');
        logs.push({
          filename: file,
          content: content.slice(-500000) // Últimos 500KB de cada archivo
        });
      }
    } catch (error) {
      console.error('Error reading logs:', error);
    }
    
    return logs;
  }
  
  async showSendLogsDialog() {
    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'Enviar logs al soporte',
      message: '¿Deseas enviar los logs de la aplicación al equipo de soporte?',
      detail: 'Esto nos ayudará a diagnosticar y resolver el problema. Los logs incluyen información del sistema pero no datos personales.',
      buttons: ['Enviar logs', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: 'Incluir información del sistema',
      checkboxChecked: true
    });
    
    if (result.response === 0) {
      return await this.sendLogs(result.checkboxChecked);
    }
    
    return null;
  }
  
  async sendLogs(includeSystemInfo = true) {
    try {
      // Mostrar diálogo de progreso
      const progressWindow = new BrowserWindow({
        width: 300,
        height: 150,
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
          nodeIntegration: true
        }
      });
      
      progressWindow.loadHTML(`
        <html>
          <body style="font-family: system-ui; padding: 20px; text-align: center;">
            <h3>Enviando logs...</h3>
            <p>Por favor espera</p>
            <progress></progress>
          </body>
        </html>
      `);
      
      // Recolectar datos
      const logs = await this.collectLogs();
      const systemInfo = includeSystemInfo ? await this.collectSystemInfo() : {};
      
      const payload = {
        logs,
        systemInfo,
        appVersion: app.getVersion(),
        licenseId: this.store.get('licenseId'),
        timestamp: new Date().toISOString()
      };
      
      // Enviar al servidor
      const response = await fetch(`${this.serverUrl}/api/logs/bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.store.get('licenseToken', '')}`
        },
        body: JSON.stringify(payload)
      });
      
      progressWindow.close();
      
      if (!response.ok) {
        throw new Error('Error al enviar logs');
      }
      
      const result = await response.json();
      
      // Guardar ID de soporte
      this.store.set('lastSupportId', result.supportId);
      
      // Mostrar resultado
      const successResult = await dialog.showMessageBox({
        type: 'info',
        title: 'Logs enviados',
        message: 'Los logs se han enviado correctamente',
        detail: `Tu ID de soporte es: ${result.supportId}\n\nEste ID ha sido copiado al portapapeles.`,
        buttons: ['OK']
      });
      
      // Copiar al portapapeles
      clipboard.writeText(result.supportId);
      
      return result.supportId;
      
    } catch (error) {
      console.error('Error sending logs:', error);
      
      dialog.showErrorBox(
        'Error al enviar logs',
        'No se pudieron enviar los logs. Por favor, intenta más tarde.'
      );
      
      return null;
    }
  }
}

module.exports = LogReporter;
```

### 3.2 Integración en el menú principal
```javascript
// main.js - Agregar al menú
const { Menu } = require('electron');
const LogReporter = require('./services/log-reporter');

function createMenu() {
  const template = [
    // ... otros menús ...
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Enviar logs de soporte',
          click: async () => {
            const logReporter = new LogReporter();
            await logReporter.showSendLogsDialog();
          }
        },
        {
          label: 'Ver ID de soporte anterior',
          click: () => {
            const Store = require('electron-store');
            const store = new Store();
            const lastSupportId = store.get('lastSupportId');
            
            if (lastSupportId) {
              const result = dialog.showMessageBoxSync({
                type: 'info',
                title: 'ID de soporte',
                message: `Tu último ID de soporte es: ${lastSupportId}`,
                buttons: ['Copiar', 'Cerrar'],
                defaultId: 0
              });
              
              if (result === 0) {
                clipboard.writeText(lastSupportId);
              }
            } else {
              dialog.showMessageBox({
                type: 'info',
                title: 'Sin ID de soporte',
                message: 'No has enviado logs anteriormente',
                buttons: ['OK']
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Buscar actualizaciones',
          click: () => {
            updaterService.checkForUpdates();
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
```

## 📋 FASE 4: Base de datos en Supabase

### 4.1 Schema completo
```sql
-- Crear todas las tablas necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de versiones
CREATE TABLE versions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('mac', 'win', 'linux')),
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('stable', 'latest', 'beta')),
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  sha512 TEXT NOT NULL,
  release_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  release_notes TEXT,
  min_app_version VARCHAR(20),
  rollout_percentage INTEGER DEFAULT 100,
  is_mandatory BOOLEAN DEFAULT FALSE,
  available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de licencias
CREATE TABLE licenses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  token UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('free', 'premium', 'lifetime', 'beta')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  features JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  last_seen_at TIMESTAMP WITH TIME ZONE
);

-- Tabla de bundles de logs para soporte
CREATE TABLE log_bundles (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  support_id VARCHAR(20) UNIQUE NOT NULL,
  license_id UUID REFERENCES licenses(id),
  app_version VARCHAR(20) NOT NULL,
  platform VARCHAR(10) NOT NULL,
  log_data JSONB,
  log_file_path TEXT,
  system_info JSONB,
  user_description TEXT,
  status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved', 'closed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT
);

-- Tabla de logs de errores
CREATE TABLE error_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  license_id UUID REFERENCES licenses(id),
  app_version VARCHAR(20) NOT NULL,
  platform VARCHAR(10) NOT NULL,
  error_type VARCHAR(50) NOT NULL,
  error_message TEXT,
  stack_trace TEXT,
  metadata JSONB DEFAULT '{}',
  session_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de crash reports
CREATE TABLE crash_reports (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  license_id UUID REFERENCES licenses(id),
  app_version VARCHAR(20) NOT NULL,
  platform VARCHAR(10) NOT NULL,
  crash_id VARCHAR(255) UNIQUE NOT NULL,
  minidump_path TEXT,
  process_type VARCHAR(50),
  crash_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar performance
CREATE INDEX idx_versions_lookup ON versions(platform, channel, available);
CREATE INDEX idx_log_bundles_support_id ON log_bundles(support_id);
CREATE INDEX idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX idx_licenses_token ON licenses(token);

-- Vista para métricas
CREATE VIEW download_metrics AS
SELECT 
  v.version,
  v.platform,
  v.channel,
  COUNT(DISTINCT l.id) as unique_users,
  v.created_at as release_date
FROM versions v
LEFT JOIN licenses l ON l.last_seen_at > v.created_at
GROUP BY v.id, v.version, v.platform, v.channel, v.created_at;
```

## 📋 FASE 5: Scripts de publicación

### 5.1 Script para publicar nueva versión
```javascript
// scripts/publish-update.js
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const glob = require('glob');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function publishUpdate() {
  const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const version = packageJson.version;
  
  console.log(`📦 Publishing version ${version}`);
  
  // Buscar archivos de build
  const platforms = [
    { name: 'mac', pattern: 'dist/*.dmg' },
    { name: 'win', pattern: 'dist/*.exe' }
  ];
  
  for (const platform of platforms) {
    const files = glob.sync(platform.pattern);
    if (!files.length) continue;
    
    const file = files[0];
    const fileBuffer = fs.readFileSync(file);
    
    // Calcular SHA512
    const hash = crypto.createHash('sha512');
    hash.update(fileBuffer);
    const sha512 = hash.digest('hex');
    
    // Subir a Supabase Storage
    const fileName = `${platform.name}/${version}/${path.basename(file)}`;
    console.log(`📤 Uploading ${fileName}...`);
    
    const { error: uploadError } = await supabase.storage
      .from('updates')
      .upload(fileName, fileBuffer);
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      continue;
    }
    
    // Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from('updates')
      .getPublicUrl(fileName);
    
    // Registrar en base de datos
    const { error: dbError } = await supabase
      .from('versions')
      .insert({
        version,
        platform: platform.name,
        channel: 'stable',
        file_path: fileName,
        file_size: fileBuffer.length,
        sha512,
        download_url: publicUrl
      });
    
    if (dbError) {
      console.error('Database error:', dbError);
      continue;
    }
    
    console.log(`✅ ${platform.name} v${version} published successfully`);
  }
}

// Ejecutar
publishUpdate().catch(console.error);
```

## 📋 FASE 6: Panel de administración

### 6.1 Dashboard de soporte
```html
<!-- admin-panel/support.html -->
<!DOCTYPE html>
<html>
<head>
  <title>CodeAgentSwarm - Panel de Soporte</title>
  <style>
    body {
      font-family: system-ui;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .dashboard {
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 20px;
      height: calc(100vh - 40px);
    }
    .ticket-list {
      background: white;
      border-radius: 8px;
      padding: 20px;
      overflow-y: auto;
    }
    .ticket-card {
      padding: 15px;
      border: 1px solid #ddd;
      border-radius: 4px;
      margin-bottom: 10px;
      cursor: pointer;
    }
    .ticket-card:hover {
      background: #f0f0f0;
    }
    .ticket-detail {
      background: white;
      border-radius: 8px;
      padding: 20px;
      overflow-y: auto;
    }
    .log-viewer {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 15px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow-x: auto;
      max-height: 400px;
    }
    .system-info {
      background: #f8f8f8;
      padding: 15px;
      border-radius: 4px;
      margin: 15px 0;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
    }
    .status-new { background: #e3f2fd; color: #1976d2; }
    .status-reviewing { background: #fff3cd; color: #856404; }
    .status-resolved { background: #d4edda; color: #155724; }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="ticket-list">
      <h2>Tickets de Soporte</h2>
      <div id="tickets"></div>
    </div>
    
    <div class="ticket-detail">
      <div id="detail-content">
        <p>Selecciona un ticket para ver los detalles</p>
      </div>
    </div>
  </div>
  
  <script>
    // Cargar tickets
    async function loadTickets() {
      const response = await fetch('/api/support/tickets');
      const tickets = await response.json();
      
      const container = document.getElementById('tickets');
      container.innerHTML = tickets.map(ticket => `
        <div class="ticket-card" onclick="loadTicketDetail('${ticket.id}')">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong>${ticket.support_id}</strong>
            <span class="status-badge status-${ticket.status}">${ticket.status}</span>
          </div>
          <div style="margin-top: 5px; color: #666; font-size: 14px;">
            ${ticket.app_version} - ${ticket.platform}
          </div>
          <div style="margin-top: 5px; color: #999; font-size: 12px;">
            ${new Date(ticket.created_at).toLocaleString()}
          </div>
        </div>
      `).join('');
    }
    
    // Cargar detalle del ticket
    async function loadTicketDetail(ticketId) {
      const response = await fetch(`/api/support/tickets/${ticketId}`);
      const ticket = await response.json();
      
      const container = document.getElementById('detail-content');
      container.innerHTML = `
        <h2>Ticket ${ticket.support_id}</h2>
        
        <div class="system-info">
          <h3>Información del Sistema</h3>
          <pre>${JSON.stringify(ticket.system_info, null, 2)}</pre>
        </div>
        
        <h3>Logs</h3>
        <div class="log-viewer">
          ${ticket.log_data ? formatLogs(ticket.log_data) : 'Ver archivo adjunto'}
        </div>
        
        <div style="margin-top: 20px;">
          <h3>Resolución</h3>
          <textarea id="resolution" style="width: 100%; height: 100px;" 
                    placeholder="Notas de resolución...">${ticket.resolution_notes || ''}</textarea>
          <div style="margin-top: 10px;">
            <button onclick="updateTicketStatus('${ticket.id}', 'reviewing')">
              Marcar como En Revisión
            </button>
            <button onclick="resolveTicket('${ticket.id}')">
              Resolver Ticket
            </button>
          </div>
        </div>
      `;
    }
    
    // Formatear logs
    function formatLogs(logs) {
      if (Array.isArray(logs)) {
        return logs.map(log => 
          `<div><strong>${log.filename}:</strong><pre>${log.content}</pre></div>`
        ).join('');
      }
      return '<pre>' + JSON.stringify(logs, null, 2) + '</pre>';
    }
    
    // Actualizar estado del ticket
    async function updateTicketStatus(ticketId, status) {
      await fetch(`/api/support/tickets/${ticketId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      loadTickets();
    }
    
    // Resolver ticket
    async function resolveTicket(ticketId) {
      const resolution = document.getElementById('resolution').value;
      await fetch(`/api/support/tickets/${ticketId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_notes: resolution })
      });
      loadTickets();
    }
    
    // Cargar al inicio
    loadTickets();
    setInterval(loadTickets, 30000); // Actualizar cada 30 segundos
  </script>
</body>
</html>
```

## 📋 RESUMEN: Lo que obtienes con este sistema

### Para los usuarios:
1. **Actualizaciones automáticas** sin tener que descargar manualmente
2. **Botón "Enviar logs"** cuando tienen problemas
3. **ID de soporte** para seguimiento de sus casos
4. **Notificaciones** claras sobre nuevas versiones

### Para ti como desarrollador:
1. **Visibilidad completa** de errores y crashes
2. **Sistema de tickets** organizado
3. **Métricas de adopción** de versiones
4. **Control sobre quién recibe qué actualizaciones**
5. **Proceso automatizado** de releases

### Infraestructura necesaria:
1. **Railway**: $5/mes para el servidor Node.js
2. **Supabase**: Gratis para empezar (1GB storage, 500MB DB)
3. **GitHub Actions**: Gratis con límites generosos
4. **Sentry** (opcional): Gratis hasta 5K eventos/mes

### Tiempo estimado de implementación:
- **Semana 1**: Sistema de actualizaciones básico
- **Semana 2**: Sistema de logs y servidor
- **Semana 3**: Panel admin y pulido
- **Semana 4**: Testing y ajustes

## 🚀 ¿Listos para empezar?

Este sistema te dará:
- ✅ Actualizaciones remotas automáticas
- ✅ Recolección de logs cuando el usuario lo solicite
- ✅ Sistema de soporte con tickets
- ✅ Control total sobre distribución
- ✅ Métricas y analytics
- ✅ Modelo freemium integrado

¿Comenzamos con la implementación?