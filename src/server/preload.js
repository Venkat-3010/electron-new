// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Authentication methods
    auth: {
        // Initiate login flow - opens browser for Azure AD authentication
        login: () => ipcRenderer.invoke('auth:login'),

        // Logout and clear session
        logout: () => ipcRenderer.invoke('auth:logout'),

        // Get current authenticated user info
        getUser: () => ipcRenderer.invoke('auth:getUser'),

        // Get access token (refreshes automatically if expired)
        getAccessToken: () => ipcRenderer.invoke('auth:getAccessToken'),

        // Listen for successful authentication
        onAuthSuccess: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('auth:success', handler);
            // Return cleanup function
            return () => ipcRenderer.removeListener('auth:success', handler);
        },

        // Listen for authentication errors
        onAuthError: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('auth:error', handler);
            // Return cleanup function
            return () => ipcRenderer.removeListener('auth:error', handler);
        },

        // Listen for max sessions reached
        onMaxSessions: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('auth:max_sessions', handler);
            // Return cleanup function
            return () => ipcRenderer.removeListener('auth:max_sessions', handler);
        },

        // Session management
        // Get all active sessions for current user
        getActiveSessions: () => ipcRenderer.invoke('auth:getActiveSessions'),

        // Terminate a specific session (logout from another device)
        terminateSession: (sessionId) => ipcRenderer.invoke('auth:terminateSession', sessionId),

        // Force login by terminating oldest session
        forceLogin: () => ipcRenderer.invoke('auth:forceLogin'),
    },

    // Item CRUD methods
    items: {
        // Get all items
        getAll: () => ipcRenderer.invoke('items:getAll'),

        // Get single item by ID
        getById: (id) => ipcRenderer.invoke('items:getById', id),

        // Create new item
        create: (itemData) => ipcRenderer.invoke('items:create', itemData),

        // Update existing item
        update: (id, itemData) => ipcRenderer.invoke('items:update', id, itemData),

        // Delete item
        delete: (id) => ipcRenderer.invoke('items:delete', id),

        // Toggle item completion status
        toggle: (id) => ipcRenderer.invoke('items:toggle', id),
    },

    // Network status methods
    network: {
        // Get current network status
        getStatus: () => ipcRenderer.invoke('network:getStatus'),

        // Listen for network status changes
        onStatusChange: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('network:status', handler);
            // Return cleanup function
            return () => ipcRenderer.removeListener('network:status', handler);
        },
    },

    // Sync methods
    sync: {
        // Get current sync status (pending, synced, error counts)
        getStatus: () => ipcRenderer.invoke('sync:getStatus'),

        // Trigger full sync (push + pull)
        trigger: () => ipcRenderer.invoke('sync:trigger'),

        // Push local changes to MSSQL
        push: () => ipcRenderer.invoke('sync:push'),

        // Pull remote changes from MSSQL
        pull: () => ipcRenderer.invoke('sync:pull'),

        // Listen for sync status updates
        onStatusChange: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('sync:status', handler);
            // Return cleanup function
            return () => ipcRenderer.removeListener('sync:status', handler);
        },
    },

    // Auto-update methods
    update: {
        // Get current app version
        getVersion: () => ipcRenderer.invoke('update:getVersion'),

        // Check for updates
        check: () => ipcRenderer.invoke('update:check'),

        // Download available update
        download: () => ipcRenderer.invoke('update:download'),

        // Install downloaded update (will restart app)
        install: () => ipcRenderer.invoke('update:install'),

        // Listen for update available event
        onUpdateAvailable: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('update:available', handler);
            return () => ipcRenderer.removeListener('update:available', handler);
        },

        // Listen for no update available event
        onUpdateNotAvailable: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('update:not-available', handler);
            return () => ipcRenderer.removeListener('update:not-available', handler);
        },

        // Listen for download progress event
        onDownloadProgress: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('update:download-progress', handler);
            return () => ipcRenderer.removeListener('update:download-progress', handler);
        },

        // Listen for update downloaded event
        onUpdateDownloaded: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('update:downloaded', handler);
            return () => ipcRenderer.removeListener('update:downloaded', handler);
        },

        // Listen for update error event
        onUpdateError: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('update:error', handler);
            return () => ipcRenderer.removeListener('update:error', handler);
        },
    },
});
