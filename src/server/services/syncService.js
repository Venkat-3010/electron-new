/**
 * Sync Service
 * Handles synchronization between SQLite (local) and MSSQL (remote)
 *
 * Sync Strategy:
 * 1. Push: Local changes (pending) → Remote
 * 2. Pull: Remote changes → Local (for multi-device support)
 * 3. Conflict resolution: Last-write-wins based on updatedAt
 */

const { Op } = require('sequelize');
const {
    getSqliteItemModel,
    getMssqlItemModel,
    isMssqlConnected,
    connectMssql,
} = require('../database');

let isSyncing = false;
let mainWindow = null;

/**
 * Set the main window for sending sync status updates
 */
const setMainWindow = (window) => {
    mainWindow = window;
};

/**
 * Send sync status to renderer
 */
const sendSyncStatus = (status, details = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:status', { status, ...details });
    }
    console.log('Sync status:', status, details);
};

/**
 * Sync all pending items to MSSQL
 */
const syncToMssql = async () => {
    if (isSyncing) {
        console.log('Sync already in progress, skipping...');
        return { success: false, reason: 'already_syncing' };
    }

    if (!isMssqlConnected()) {
        console.log('MSSQL not connected, attempting to connect...');
        const connected = await connectMssql();
        if (!connected) {
            console.log('Failed to connect to MSSQL');
            return { success: false, reason: 'not_connected' };
        }
    }

    isSyncing = true;
    sendSyncStatus('syncing');

    const SqliteItem = getSqliteItemModel();
    const MssqlItem = getMssqlItemModel();

    if (!SqliteItem || !MssqlItem) {
        isSyncing = false;
        return { success: false, reason: 'models_not_initialized' };
    }

    let syncedCount = 0;
    let errorCount = 0;

    try {
        // Get all pending items (including deleted ones)
        const pendingItems = await SqliteItem.findAll({
            where: {
                syncStatus: 'pending',
            },
        });

        console.log(`Found ${pendingItems.length} items to sync`);

        for (const localItem of pendingItems) {
            try {
                if (localItem.isDeleted) {
                    // Handle deletion
                    await syncDeletedItem(localItem, MssqlItem, SqliteItem);
                } else {
                    // Handle create/update
                    await syncItem(localItem, MssqlItem, SqliteItem);
                }
                syncedCount++;
            } catch (error) {
                console.error(`Failed to sync item ${localItem.uuid}:`, error);
                // Mark as error
                await localItem.update({ syncStatus: 'error' });
                errorCount++;
            }
        }

        isSyncing = false;

        const result = {
            success: true,
            syncedCount,
            errorCount,
            totalPending: pendingItems.length,
        };

        sendSyncStatus('completed', result);
        return result;

    } catch (error) {
        console.error('Sync failed:', error);
        isSyncing = false;
        sendSyncStatus('error', { message: error.message });
        return { success: false, reason: 'sync_error', error: error.message };
    }
};

/**
 * Sync a single item to MSSQL
 */
const syncItem = async (localItem, MssqlItem, SqliteItem) => {
    // Check if item exists in MSSQL
    const remoteItem = await MssqlItem.findOne({
        where: { uuid: localItem.uuid },
    });

    const itemData = {
        uuid: localItem.uuid,
        title: localItem.title,
        description: localItem.description,
        completed: localItem.completed,
        priority: localItem.priority,
        createdAt: localItem.createdAt,
        updatedAt: localItem.updatedAt,
    };

    if (remoteItem) {
        // Update existing item (last-write-wins)
        if (localItem.updatedAt > remoteItem.updatedAt) {
            await remoteItem.update(itemData);
            console.log(`Updated item in MSSQL: ${localItem.uuid}`);
        } else {
            console.log(`Remote item is newer, skipping: ${localItem.uuid}`);
        }
    } else {
        // Create new item
        await MssqlItem.create(itemData);
        console.log(`Created item in MSSQL: ${localItem.uuid}`);
    }

    // Mark as synced
    await localItem.update({
        syncStatus: 'synced',
        syncedAt: new Date(),
    });
};

/**
 * Sync a deleted item (remove from MSSQL)
 */
const syncDeletedItem = async (localItem, MssqlItem, SqliteItem) => {
    // Delete from MSSQL
    await MssqlItem.destroy({
        where: { uuid: localItem.uuid },
    });

    console.log(`Deleted item from MSSQL: ${localItem.uuid}`);

    // Now we can actually delete from SQLite
    await localItem.destroy();
};

/**
 * Pull items from MSSQL to SQLite (for multi-device support)
 */
const syncFromMssql = async () => {
    if (!isMssqlConnected()) {
        return { success: false, reason: 'not_connected' };
    }

    const SqliteItem = getSqliteItemModel();
    const MssqlItem = getMssqlItemModel();

    if (!SqliteItem || !MssqlItem) {
        return { success: false, reason: 'models_not_initialized' };
    }

    try {
        // Get all items from MSSQL
        const remoteItems = await MssqlItem.findAll();

        let pulledCount = 0;

        for (const remoteItem of remoteItems) {
            const localItem = await SqliteItem.findOne({
                where: { uuid: remoteItem.uuid },
            });

            if (!localItem) {
                // Create locally
                await SqliteItem.create({
                    uuid: remoteItem.uuid,
                    title: remoteItem.title,
                    description: remoteItem.description,
                    completed: remoteItem.completed,
                    priority: remoteItem.priority,
                    syncStatus: 'synced',
                    syncedAt: new Date(),
                    isDeleted: false,
                    createdAt: remoteItem.createdAt,
                    updatedAt: remoteItem.updatedAt,
                });
                pulledCount++;
            } else if (localItem.syncStatus === 'synced' && remoteItem.updatedAt > localItem.updatedAt) {
                // Update local if remote is newer and local isn't pending
                await localItem.update({
                    title: remoteItem.title,
                    description: remoteItem.description,
                    completed: remoteItem.completed,
                    priority: remoteItem.priority,
                    syncedAt: new Date(),
                    updatedAt: remoteItem.updatedAt,
                });
                pulledCount++;
            }
        }

        return { success: true, pulledCount };

    } catch (error) {
        console.error('Pull from MSSQL failed:', error);
        return { success: false, reason: 'pull_error', error: error.message };
    }
};

/**
 * Full bidirectional sync
 */
const fullSync = async () => {
    sendSyncStatus('syncing');

    // First push local changes
    const pushResult = await syncToMssql();

    // Then pull remote changes
    const pullResult = await syncFromMssql();

    const result = {
        success: pushResult.success && pullResult.success,
        pushed: pushResult,
        pulled: pullResult,
    };

    sendSyncStatus('completed', result);
    return result;
};

/**
 * Get sync status summary
 */
const getSyncStatus = async () => {
    const SqliteItem = getSqliteItemModel();

    if (!SqliteItem) {
        return { pending: 0, synced: 0, error: 0 };
    }

    const pending = await SqliteItem.count({ where: { syncStatus: 'pending', isDeleted: false } });
    const synced = await SqliteItem.count({ where: { syncStatus: 'synced', isDeleted: false } });
    const error = await SqliteItem.count({ where: { syncStatus: 'error', isDeleted: false } });

    return { pending, synced, error, isMssqlConnected: isMssqlConnected() };
};

module.exports = {
    setMainWindow,
    syncToMssql,
    syncFromMssql,
    fullSync,
    getSyncStatus,
    sendSyncStatus,
};
