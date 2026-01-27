const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { PROTOCOL_SCHEME } = require('./config/msalConfig');
const authController = require('./controllers/authController');
const { registerAuthHandlers } = require('./ipc/authHandlers');

if (require('electron-squirrel-startup')) {
    app.quit();
}

let mainWindow = null;

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        },
    });

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    authController.setMainWindow(mainWindow);
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

if (!gotTheLock) {
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

    app.whenReady().then(() => {
        registerProtocol();
        authController.initialize();
        registerAuthHandlers();
        createWindow();

        const protocolUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
        if (protocolUrl) {
            setTimeout(() => handleProtocolUrl(protocolUrl), 500);
        }

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
