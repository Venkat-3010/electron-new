const { ipcMain } = require('electron');
const authController = require('../controllers/authController');

function registerAuthHandlers() {
    ipcMain.handle('auth:login', async () => {
        try {
            return await authController.login();
        } catch (error) {
            console.error('Failed to start login:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('auth:logout', async () => {
        return await authController.logout();
    });

    ipcMain.handle('auth:getUser', () => {
        return authController.getUser();
    });

    ipcMain.handle('auth:getAccessToken', async () => {
        try {
            return await authController.getAccessToken();
        } catch (error) {
            console.error('Failed to get access token:', error);
            return { success: false, error: error.message };
        }
    });

    // Session management handlers
    ipcMain.handle('auth:getActiveSessions', async () => {
        try {
            return await authController.getActiveSessions();
        } catch (error) {
            console.error('Failed to get active sessions:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('auth:terminateSession', async (_event, sessionId) => {
        try {
            return await authController.terminateSession(sessionId);
        } catch (error) {
            console.error('Failed to terminate session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('auth:forceLogin', async () => {
        try {
            return await authController.forceLogin();
        } catch (error) {
            console.error('Failed to force login:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = { registerAuthHandlers };
