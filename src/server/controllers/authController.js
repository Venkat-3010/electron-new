const { shell } = require('electron');
const keytar = require('keytar');
const { PublicClientApplication } = require('@azure/msal-node');
const { MSAL_CONFIG, REDIRECT_URI, LOGIN_SCOPES } = require('../config/msalConfig');
const { generatePkce } = require('../utils/pkce');
const sessionService = require('../services/sessionService');

const SERVICE_NAME = 'electron-crud-poc';
const CHUNK_SIZE = 2000; // Windows Credential Manager limit is ~2.5KB, use 2KB to be safe

let msalClient = null;
let pkceVerifier = null;
let authenticatedUser = null;
let cachedAccount = null;
let mainWindow = null;
let currentSessionId = null;

// Split data into chunks for Windows Credential Manager storage
const saveToCredentialManager = async (data) => {
    // First, clear all existing chunks
    await clearCredentialManager();

    // Split data into chunks
    const chunks = [];
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        chunks.push(data.slice(i, i + CHUNK_SIZE));
    }

    // Save chunk count
    await keytar.setPassword(SERVICE_NAME, 'chunk-count', String(chunks.length));

    // Save each chunk
    for (let i = 0; i < chunks.length; i++) {
        await keytar.setPassword(SERVICE_NAME, `chunk-${i}`, chunks[i]);
    }

    console.log(`Cache saved to Windows Credential Manager (${chunks.length} chunks)`);
};

// Load and reassemble chunks from Windows Credential Manager
const loadFromCredentialManager = async () => {
    const countStr = await keytar.getPassword(SERVICE_NAME, 'chunk-count');
    if (!countStr) {
        return null;
    }

    const count = parseInt(countStr, 10);
    const chunks = [];

    for (let i = 0; i < count; i++) {
        const chunk = await keytar.getPassword(SERVICE_NAME, `chunk-${i}`);
        if (chunk) {
            chunks.push(chunk);
        }
    }

    if (chunks.length !== count) {
        console.error('Cache corrupted: missing chunks');
        return null;
    }

    console.log(`Cache loaded from Windows Credential Manager (${count} chunks)`);
    return chunks.join('');
};

// Clear all credentials for this service
const clearCredentialManager = async () => {
    const credentials = await keytar.findCredentials(SERVICE_NAME);
    for (const cred of credentials) {
        await keytar.deletePassword(SERVICE_NAME, cred.account);
    }
};

const createKeytarCachePlugin = () => {
    return {
        beforeCacheAccess: async (cacheContext) => {
            try {
                const cachedData = await loadFromCredentialManager();
                if (cachedData) {
                    cacheContext.tokenCache.deserialize(cachedData);
                }
            } catch (error) {
                console.error('Error reading from credential store:', error);
            }
        },
        afterCacheAccess: async (cacheContext) => {
            if (cacheContext.cacheHasChanged) {
                try {
                    const data = cacheContext.tokenCache.serialize();
                    await saveToCredentialManager(data);
                } catch (error) {
                    console.error('Error writing to credential store:', error);
                }
            }
        },
    };
};

const initialize = async () => {
    msalClient = new PublicClientApplication({
        auth: MSAL_CONFIG.auth,
        cache: {
            cachePlugin: createKeytarCachePlugin(),
        },
    });

    // Restore user session from cached accounts
    await restoreUserSession();

    console.log('MSAL initialized with Windows Credential Manager');
};

const restoreUserSession = async () => {
    try {
        const accounts = await msalClient.getTokenCache().getAllAccounts();
        if (accounts.length > 0) {
            cachedAccount = accounts[0];
            const userId = cachedAccount.homeAccountId || cachedAccount.localAccountId;

            // Check if this device has an active session
            const deviceSession = await sessionService.getCurrentDeviceSession(userId);

            if (deviceSession) {
                // Validate the session is still active
                const isValid = await sessionService.validateSession(deviceSession.sessionId);
                if (isValid) {
                    currentSessionId = deviceSession.sessionId;
                    authenticatedUser = {
                        name: cachedAccount.name || 'Unknown User',
                        email: cachedAccount.username || '',
                        homeAccountId: cachedAccount.homeAccountId,
                    };
                    console.log('Restored user session for:', authenticatedUser.name);
                } else {
                    console.log('Session expired or invalidated, clearing local cache');
                    await clearLocalSession();
                }
            } else {
                // No session for this device, check if we can create one
                const canCreate = await sessionService.canCreateSession(userId);
                if (canCreate.allowed) {
                    // Auto-create session for restored user
                    const tokenResponse = await msalClient.acquireTokenSilent({
                        account: cachedAccount,
                        scopes: LOGIN_SCOPES,
                    });
                    const result = await sessionService.createSession(
                        userId,
                        cachedAccount.username,
                        tokenResponse.expiresOn
                    );
                    if (result.success) {
                        currentSessionId = result.sessionId;
                        authenticatedUser = {
                            name: cachedAccount.name || 'Unknown User',
                            email: cachedAccount.username || '',
                            homeAccountId: cachedAccount.homeAccountId,
                        };
                        console.log('Created new session for restored user:', authenticatedUser.name);
                    }
                } else {
                    console.log('Max sessions reached, cannot restore session');
                    await clearLocalSession();
                }
            }
        }
    } catch (error) {
        console.error('Failed to restore user session:', error);
    }
};

const clearLocalSession = async () => {
    authenticatedUser = null;
    cachedAccount = null;
    currentSessionId = null;

    const accounts = await msalClient.getTokenCache().getAllAccounts();
    for (const account of accounts) {
        await msalClient.getTokenCache().removeAccount(account);
    }
    await clearCredentialManager();
};

const setMainWindow = (window) => {
    mainWindow = window;
};

const getUser = () => authenticatedUser;

const buildAuthUrl = (codeChallenge) => {
    const params = new URLSearchParams({
        client_id: MSAL_CONFIG.auth.clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: LOGIN_SCOPES.join(' '),
        response_mode: 'query',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });

    return `${MSAL_CONFIG.auth.authority}/oauth2/v2.0/authorize?${params.toString()}`;
};

const extractCodeFromUrl = (url) => {
    try {
        return new URL(url).searchParams.get('code');
    } catch (error) {
        console.error('Failed to parse auth URL:', error);
        return null;
    }
};

const sendToRenderer = (channel, data) => {
    if (mainWindow) {
        mainWindow.webContents.send(channel, data);
    }
};

const login = async () => {
    const { verifier, challenge } = generatePkce();
    pkceVerifier = verifier;

    const authUrl = buildAuthUrl(challenge);
    await shell.openExternal(authUrl);

    return { success: true };
};

const logout = async () => {
    // End the current session
    if (currentSessionId) {
        await sessionService.endSession(currentSessionId);
        console.log('Session ended:', currentSessionId);
    }

    const userId = cachedAccount?.homeAccountId || cachedAccount?.localAccountId;
    if (userId) {
        await sessionService.endCurrentDeviceSession(userId);
    }

    authenticatedUser = null;
    cachedAccount = null;
    pkceVerifier = null;
    currentSessionId = null;

    const accounts = await msalClient.getTokenCache().getAllAccounts();
    for (const account of accounts) {
        await msalClient.getTokenCache().removeAccount(account);
    }

    // Clear all chunks from Windows Credential Manager
    try {
        await clearCredentialManager();
        console.log('Credentials cleared from Windows Credential Manager');
    } catch (error) {
        console.error('Error clearing credential store:', error);
    }

    return { success: true };
};

const getAccessToken = async () => {
    if (!cachedAccount) {
        // Try to get account from cache
        const accounts = await msalClient.getTokenCache().getAllAccounts();
        if (accounts.length > 0) {
            cachedAccount = accounts[0];
        } else {
            return { success: false, error: 'No authenticated user. Please login first.' };
        }
    }

    // Validate current session is still active
    if (currentSessionId) {
        const isValid = await sessionService.validateSession(currentSessionId);
        if (!isValid) {
            console.log('Session invalidated, requiring re-login');
            await clearLocalSession();
            return {
                success: false,
                error: 'Session has been terminated. Please login again.',
                requiresLogin: true,
                sessionTerminated: true,
            };
        }
    }

    try {
        const tokenResponse = await msalClient.acquireTokenSilent({
            account: cachedAccount,
            scopes: LOGIN_SCOPES,
        });

        console.log('Token refreshed, expires on:', tokenResponse.expiresOn);

        // Update session expiry
        const userId = cachedAccount.homeAccountId || cachedAccount.localAccountId;
        await sessionService.updateSessionExpiry(userId, tokenResponse.expiresOn);

        return {
            success: true,
            accessToken: tokenResponse.accessToken,
            expiresOn: tokenResponse.expiresOn,
        };
    } catch (error) {
        console.error('Silent token acquisition failed:', error);

        // If silent acquisition fails, user needs to re-authenticate
        if (error.name === 'InteractionRequiredAuthError') {
            return {
                success: false,
                error: 'Session expired. Please login again.',
                requiresLogin: true,
            };
        }

        return { success: false, error: error.message };
    }
};

const handleAuthRedirect = async (url) => {
    const code = extractCodeFromUrl(url);

    if (!code) {
        sendToRenderer('auth:error', { message: 'No authorization code received' });
        return;
    }

    if (!pkceVerifier) {
        sendToRenderer('auth:error', { message: 'Authentication flow interrupted' });
        return;
    }

    try {
        const tokenResponse = await msalClient.acquireTokenByCode({
            code,
            scopes: LOGIN_SCOPES,
            redirectUri: REDIRECT_URI,
            codeVerifier: pkceVerifier
        });

        console.log('Token expires on:', tokenResponse.expiresOn);

        pkceVerifier = null;
        cachedAccount = tokenResponse.account;

        const userId = tokenResponse.account?.homeAccountId || tokenResponse.account?.localAccountId;
        const userEmail = tokenResponse.account?.username;

        // Check concurrent session limit before allowing login
        const canCreate = await sessionService.canCreateSession(userId);

        if (!canCreate.allowed) {
            console.log(`Max sessions (${sessionService.MAX_CONCURRENT_SESSIONS}) reached for user:`, userEmail);

            // Send error to renderer with session info
            sendToRenderer('auth:max_sessions', {
                message: `Maximum ${sessionService.MAX_CONCURRENT_SESSIONS} concurrent sessions allowed`,
                activeSessions: canCreate.activeSessions,
                maxSessions: canCreate.maxSessions,
                existingSessions: canCreate.oldestSessions,
            });
            return;
        }

        // Create session for this device
        const sessionResult = await sessionService.createSession(
            userId,
            userEmail,
            tokenResponse.expiresOn
        );

        if (!sessionResult.success) {
            console.error('Failed to create session:', sessionResult.error);
            sendToRenderer('auth:error', {
                message: sessionResult.message || 'Failed to create session',
            });
            return;
        }

        currentSessionId = sessionResult.sessionId;

        authenticatedUser = {
            name: tokenResponse.account?.name || 'Unknown User',
            email: tokenResponse.account?.username || '',
            homeAccountId: tokenResponse.account?.homeAccountId,
        };

        console.log('Authentication successful:', authenticatedUser.name);
        console.log('Session created:', currentSessionId);

        sendToRenderer('auth:success', {
            user: authenticatedUser,
            accessToken: tokenResponse.accessToken,
            sessionId: currentSessionId,
        });
    } catch (error) {
        console.error('Token exchange failed:', error);
        pkceVerifier = null;
        sendToRenderer('auth:error', { message: error.message || 'Authentication failed' });
    }
};

/**
 * Get all active sessions for the current user
 */
const getActiveSessions = async () => {
    if (!cachedAccount) {
        return { success: false, error: 'No authenticated user' };
    }

    const userId = cachedAccount.homeAccountId || cachedAccount.localAccountId;
    const sessions = await sessionService.getActiveSessions(userId);

    return {
        success: true,
        sessions,
        currentSessionId,
        maxSessions: sessionService.MAX_CONCURRENT_SESSIONS,
    };
};

/**
 * Terminate a specific session (logout from another device)
 */
const terminateSession = async (sessionId) => {
    if (!cachedAccount) {
        return { success: false, error: 'No authenticated user' };
    }

    // Don't allow terminating current session via this method
    if (sessionId === currentSessionId) {
        return { success: false, error: 'Cannot terminate current session. Use logout instead.' };
    }

    const result = await sessionService.endSession(sessionId);
    return { success: result };
};

/**
 * Force login by terminating oldest session
 */
const forceLogin = async () => {
    if (!cachedAccount) {
        return { success: false, error: 'No authenticated user' };
    }

    const userId = cachedAccount.homeAccountId || cachedAccount.localAccountId;
    const userEmail = cachedAccount.username;

    try {
        const tokenResponse = await msalClient.acquireTokenSilent({
            account: cachedAccount,
            scopes: LOGIN_SCOPES,
        });

        // Force create session (will remove oldest if needed)
        const sessionResult = await sessionService.createSession(
            userId,
            userEmail,
            tokenResponse.expiresOn,
            true // forceCreate = true
        );

        if (sessionResult.success) {
            currentSessionId = sessionResult.sessionId;
            authenticatedUser = {
                name: cachedAccount.name || 'Unknown User',
                email: cachedAccount.username || '',
                homeAccountId: cachedAccount.homeAccountId,
            };

            return {
                success: true,
                user: authenticatedUser,
                accessToken: tokenResponse.accessToken,
                sessionId: currentSessionId,
            };
        }

        return { success: false, error: 'Failed to create session' };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

module.exports = {
    initialize,
    setMainWindow,
    getUser,
    getAccessToken,
    login,
    logout,
    handleAuthRedirect,
    getActiveSessions,
    terminateSession,
    forceLogin,
};
