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
}

module.exports = { registerAuthHandlers };
