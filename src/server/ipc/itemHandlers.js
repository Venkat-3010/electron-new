/**
 * IPC Handlers for Item CRUD operations
 */

const { ipcMain } = require('electron');
const itemController = require('../controllers/itemController');
const syncService = require('../services/syncService');
const { isMssqlConnected, connectMssql, getMssqlUnavailableReason } = require('../database');

function registerItemHandlers() {
    // Get all items
    ipcMain.handle('items:getAll', async () => {
        return await itemController.getAllItems();
    });

    // Get single item by ID
    ipcMain.handle('items:getById', async (_event, id) => {
        return await itemController.getItemById(id);
    });

    // Create new item
    ipcMain.handle('items:create', async (_event, itemData) => {
        return await itemController.createItem(itemData);
    });

    // Update existing item
    ipcMain.handle('items:update', async (_event, id, itemData) => {
        return await itemController.updateItem(id, itemData);
    });

    // Delete item
    ipcMain.handle('items:delete', async (_event, id) => {
        return await itemController.deleteItem(id);
    });

    // Toggle item completion
    ipcMain.handle('items:toggle', async (_event, id) => {
        return await itemController.toggleItemCompleted(id);
    });

    // Sync operations
    // Get sync status
    ipcMain.handle('sync:getStatus', async () => {
        return await syncService.getSyncStatus();
    });

    // Trigger manual sync
    ipcMain.handle('sync:trigger', async () => {
        try {
            // Try to connect to MSSQL if not connected
            if (!isMssqlConnected()) {
                console.log('MSSQL not connected, attempting to connect...');
                await connectMssql();
            }

            if (!isMssqlConnected()) {
                const reason = getMssqlUnavailableReason() || 'unknown';
                console.log('MSSQL connection failed. Reason:', reason);
                return {
                    success: false,
                    reason: 'mssql_not_available',
                    details: reason
                };
            }

            return await syncService.fullSync();
        } catch (error) {
            console.error('Sync trigger error:', error);
            return { success: false, error: error.message };
        }
    });

    // Push local changes to MSSQL
    ipcMain.handle('sync:push', async () => {
        return await syncService.syncToMssql();
    });

    // Pull remote changes from MSSQL
    ipcMain.handle('sync:pull', async () => {
        return await syncService.syncFromMssql();
    });
}

module.exports = { registerItemHandlers };
