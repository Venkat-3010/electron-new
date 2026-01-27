const path = require('node:path');

// Load environment variables from .env file
// In development, the .env is at project root
// In production, it should be in the app's resources or userData
const envPath = process.env.NODE_ENV === 'production'
    ? path.join(process.resourcesPath, '.env')
    : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

// Fallback: try loading from current working directory
if (!process.env.DB_HOST) {
    require('dotenv').config();
}

console.log('Environment loaded - DB_HOST:', process.env.DB_HOST);

const { app, BrowserWindow, net, ipcMain } = require('electron');
const fs = require('node:fs');
const { PROTOCOL_SCHEME } = require('./config/msalConfig');
const { setSqlitePath } = require('./config/dbConfig');
const { initializeDatabase, connectMssql, disconnectMssql, isMssqlConnected } = require('./database');
const authController = require('./controllers/authController');
const { registerAuthHandlers } = require('./ipc/authHandlers');
const { registerItemHandlers } = require('./ipc/itemHandlers');
const syncService = require('./services/syncService');
const autoUpdateService = require('./services/autoUpdateService');

if (require('electron-squirrel-startup')) {
    app.quit();
}

let mainWindow = null;
let networkCheckInterval = null;
let lastOnlineStatus = null;

// Check actual internet connectivity by pinging a server
const checkInternetConnectivity = () => {
    return new Promise((resolve) => {
        // First check if network adapter is connected
        if (!net.isOnline()) {
            resolve(false);
            return;
        }

        // Then verify actual internet by making a request
        const request = net.request({
            method: 'HEAD',
            url: 'https://www.google.com',
        });

        request.on('response', () => {
            resolve(true);
        });

        request.on('error', () => {
            resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
            request.abort();
            resolve(false);
        }, 5000);

        request.end();
    });
};

// Check network connectivity
const checkNetworkStatus = async () => {
    const isOnline = await checkInternetConnectivity();

    // Only send if status changed
    if (lastOnlineStatus !== isOnline) {
        const wasOffline = lastOnlineStatus === false;
        lastOnlineStatus = isOnline;
        sendNetworkStatus(isOnline);
        console.log('Network status changed:', isOnline ? 'Online' : 'Offline');

        // If we just came online, try to sync
        if (isOnline && wasOffline) {
            console.log('Network restored - triggering sync...');
            triggerSync();
        }
    }

    return isOnline;
};

// Trigger sync to MSSQL when online
const triggerSync = async () => {
    try {
        // First try to connect to MSSQL if not connected
        if (!isMssqlConnected()) {
            console.log('Attempting to connect to MSSQL...');
            await connectMssql();
        }

        if (isMssqlConnected()) {
            console.log('Starting sync to MSSQL...');
            const result = await syncService.fullSync();
            console.log('Sync result:', result);
        } else {
            console.log('MSSQL not available, sync skipped');
        }
    } catch (error) {
        console.error('Sync error:', error);
    }
};

// Send network status to renderer
const sendNetworkStatus = (isOnline) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('network:status', { isOnline });
    }
};

// Start network monitoring
const startNetworkMonitoring = () => {
    // Check immediately
    checkNetworkStatus();

    // Check every 10 seconds
    networkCheckInterval = setInterval(checkNetworkStatus, 10000);
};

// Stop network monitoring
const stopNetworkMonitoring = () => {
    if (networkCheckInterval) {
        clearInterval(networkCheckInterval);
        networkCheckInterval = null;
    }
};

// IPC handler for getting current network status
ipcMain.handle('network:getStatus', async () => {
    const isOnline = await checkInternetConnectivity();
    return { isOnline };
});

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: true, // Explicitly show the window
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        },
    });

    console.log('Loading URL:', MAIN_WINDOW_WEBPACK_ENTRY);
    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    // Only open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    // Log any loading errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        stopNetworkMonitoring();
    });

    // Send initial network status when window is ready
    mainWindow.webContents.on('did-finish-load', async () => {
        const isOnline = await checkInternetConnectivity();
        lastOnlineStatus = isOnline;
        sendNetworkStatus(isOnline);
    });

    // Start network monitoring
    startNetworkMonitoring();

    authController.setMainWindow(mainWindow);
    syncService.setMainWindow(mainWindow);
    autoUpdateService.setMainWindow(mainWindow);
};

const focusMainWindow = () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
};

const registerProtocol = () => {
    if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
            path.resolve(process.argv[1]),
        ]);
    } else {
        app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
    }
};

const handleProtocolUrl = (url) => {
    if (url?.startsWith(`${PROTOCOL_SCHEME}://`)) {
        authController.handleAuthRedirect(url);
        focusMainWindow();
    }
};

const gotTheLock = app.requestSingleInstanceLock();
console.log('Single instance lock acquired:', gotTheLock);

if (!gotTheLock) {
    console.log('Another instance is running, quitting...');
    app.quit();
} else {
    app.on('second-instance', (_event, commandLine) => {
        const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
        handleProtocolUrl(url);
        focusMainWindow();
    });

    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleProtocolUrl(url);
    });

    app.whenReady().then(async () => {
        try {
            console.log('App ready, starting initialization...');
            registerProtocol();

            // Set up database folder in userData (OS-level secure location)
            const dbFolder = path.join(app.getPath('userData'), 'database');
            console.log('Database folder:', dbFolder);
            if (!fs.existsSync(dbFolder)) {
                fs.mkdirSync(dbFolder, { recursive: true });
            }
            const dbFilePath = path.join(dbFolder, 'app.db');
            setSqlitePath(dbFilePath, dbFolder);

            // Initialize database
            console.log('Initializing database...');
            await initializeDatabase();
            console.log('Database initialized');

            console.log('Initializing auth controller...');
            await authController.initialize();
            console.log('Auth controller initialized');

            registerAuthHandlers();
            registerItemHandlers();

            console.log('Creating window...');
            createWindow();
            console.log('Window created');

            autoUpdateService.initialize();

            const protocolUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
            if (protocolUrl) {
                setTimeout(() => handleProtocolUrl(protocolUrl), 500);
            }

            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    createWindow();
                }
            });
        } catch (error) {
            console.error('FATAL ERROR during startup:', error);
            const { dialog } = require('electron');
            dialog.showErrorBox('Startup Error', `Failed to start application:\n\n${error.message}\n\n${error.stack}`);
            app.quit();
        }
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
