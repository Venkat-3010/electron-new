const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

let mainWindow = null;

// Configure auto-updater
autoUpdater.autoDownload = false; // Don't download automatically, let user decide
autoUpdater.autoInstallOnAppQuit = true;

const setMainWindow = (window) => {
    mainWindow = window;
};

const sendStatusToWindow = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
};

// Initialize auto-updater and set up event handlers
const initialize = () => {
    // Check for updates on app start (only in production)
    if (process.env.NODE_ENV !== 'development') {
        // Delay initial check to let app fully load
        setTimeout(() => {
            checkForUpdates();
        }, 3000);
    }

    // Event: Update available
    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info.version);
        sendStatusToWindow('update:available', {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
        });
    });

    // Event: No update available
    autoUpdater.on('update-not-available', (info) => {
        console.log('No update available. Current version:', info.version);
        sendStatusToWindow('update:not-available', {
            version: info.version,
        });
    });

    // Event: Download progress
    autoUpdater.on('download-progress', (progress) => {
        console.log(`Download progress: ${progress.percent.toFixed(1)}%`);
        sendStatusToWindow('update:download-progress', {
            percent: progress.percent,
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total,
        });
    });

    // Event: Update downloaded
    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded:', info.version);
        sendStatusToWindow('update:downloaded', {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
        });
    });

    // Event: Error
    autoUpdater.on('error', (error) => {
        console.error('Auto-updater error:', error);
        sendStatusToWindow('update:error', {
            message: error.message || 'Unknown error occurred',
        });
    });

    // Register IPC handlers
    registerIpcHandlers();
};

// Check for updates
const checkForUpdates = async () => {
    try {
        console.log('Checking for updates...');
        const result = await autoUpdater.checkForUpdates();
        return result;
    } catch (error) {
        console.error('Error checking for updates:', error);
        throw error;
    }
};

// Download update
const downloadUpdate = async () => {
    try {
        console.log('Downloading update...');
        await autoUpdater.downloadUpdate();
    } catch (error) {
        console.error('Error downloading update:', error);
        throw error;
    }
};

// Install update and restart
const installUpdate = () => {
    console.log('Installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);
};

// Register IPC handlers for renderer communication
const registerIpcHandlers = () => {
    // Check for updates
    ipcMain.handle('update:check', async () => {
        try {
            await checkForUpdates();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Download update
    ipcMain.handle('update:download', async () => {
        try {
            await downloadUpdate();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Install update
    ipcMain.handle('update:install', () => {
        installUpdate();
        return { success: true };
    });

    // Get current version
    ipcMain.handle('update:getVersion', () => {
        const { app } = require('electron');
        return { version: app.getVersion() };
    });
};

module.exports = {
    setMainWindow,
    initialize,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
};
