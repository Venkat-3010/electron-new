/**
 * Azure AD MSAL Configuration for PKCE Authentication
 *
 * TODO: Configure these values from your Azure AD App Registration:
 * 1. Go to Azure Portal > Azure Active Directory > App registrations
 * 2. Create a new registration or use existing one
 * 3. Set the redirect URI to: msal-electron-poc://auth (as "Public client/native")
 * 4. Copy the Application (client) ID and Directory (tenant) ID
 */

const MSAL_CONFIG = {
    auth: {
        // TODO: Replace with your Azure AD Application (client) ID
        clientId: 'e0189829-a4ed-4372-a66f-28061f994c3a ',

        // TODO: Replace with your Azure AD Directory (tenant) ID
        // Use 'common' for multi-tenant, 'organizations' for work accounts only,
        // or your specific tenant ID for single-tenant apps
        authority: 'https://login.microsoftonline.com/3e8e53be-a48f-4147-adf8-7e90a6e46b57',
    },
    cache: {
        // Cache location - for Electron we use in-memory
        cacheLocation: 'memory',
    },
};

// Custom protocol for OAuth redirect
const REDIRECT_URI = 'msal-electron-poc://auth';

// Scopes to request during authentication
const LOGIN_SCOPES = ['User.Read', 'openid', 'profile', 'email', 'offline_access'];

// Protocol scheme (without ://)
const PROTOCOL_SCHEME = 'msal-electron-poc';

module.exports = {
    MSAL_CONFIG,
    REDIRECT_URI,
    LOGIN_SCOPES,
    PROTOCOL_SCHEME,
};
