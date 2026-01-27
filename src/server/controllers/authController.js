const { shell } = require('electron');
const { PublicClientApplication } = require('@azure/msal-node');
const { MSAL_CONFIG, REDIRECT_URI, LOGIN_SCOPES } = require('../config/msalConfig');
const { generatePkce } = require('../utils/pkce');

let msalClient = null;
let pkceVerifier = null;
let authenticatedUser = null;
let mainWindow = null;

const initialize = () => {
    msalClient = new PublicClientApplication({
        auth: MSAL_CONFIG.auth,
    });
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
    authenticatedUser = null;
    pkceVerifier = null;

    const accounts = await msalClient.getTokenCache().getAllAccounts();
    for (const account of accounts) {
        await msalClient.getTokenCache().removeAccount(account);
    }

    return { success: true };
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
        console.log('Token response:', tokenResponse);

        pkceVerifier = null;

        authenticatedUser = {
            name: tokenResponse.account?.name || 'Unknown User',
            email: tokenResponse.account?.username || '',
            homeAccountId: tokenResponse.account?.homeAccountId,
        };

        console.log('Authentication successful:', authenticatedUser.name);

        sendToRenderer('auth:success', {
            user: authenticatedUser,
            accessToken: tokenResponse.accessToken,
        });
    } catch (error) {
        console.error('Token exchange failed:', error);
        pkceVerifier = null;
        sendToRenderer('auth:error', { message: error.message || 'Authentication failed' });
    }
};

module.exports = {
    initialize,
    setMainWindow,
    getUser,
    login,
    logout,
    handleAuthRedirect,
};
