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
    },
});
