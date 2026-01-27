# Authentication Flow

This document explains the Azure AD authentication flow using PKCE (Proof Key for Code Exchange) in the Electron application.

## Overview

The application uses OAuth 2.0 Authorization Code flow with PKCE for secure authentication. This flow is recommended for public clients (desktop/mobile apps) where a client secret cannot be securely stored.

## Flow Diagram

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Renderer   │      │    Main      │      │   System     │      │   Azure AD   │
│   Process    │      │   Process    │      │   Browser    │      │              │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │                     │
       │  1. Click Login     │                     │                     │
       │────────────────────>│                     │                     │
       │                     │                     │                     │
       │                     │  2. Generate PKCE   │                     │
       │                     │  (verifier+challenge)                     │
       │                     │                     │                     │
       │                     │  3. Open Auth URL   │                     │
       │                     │────────────────────>│                     │
       │                     │                     │                     │
       │                     │                     │  4. User Login      │
       │                     │                     │────────────────────>│
       │                     │                     │                     │
       │                     │                     │  5. Auth Code       │
       │                     │                     │<────────────────────│
       │                     │                     │                     │
       │                     │  6. Protocol Redirect                     │
       │                     │  (msal-electron-poc://auth?code=xxx)      │
       │                     │<────────────────────│                     │
       │                     │                     │                     │
       │                     │  7. Exchange Code   │                     │
       │                     │─────────────────────────────────────────>│
       │                     │                     │                     │
       │                     │  8. Access Token    │                     │
       │                     │<─────────────────────────────────────────│
       │                     │                     │                     │
       │  9. Auth Success    │                     │                     │
       │<────────────────────│                     │                     │
       │                     │                     │                     │
```

## Step-by-Step Explanation

### Step 1: User Initiates Login

The user clicks the "Sign in with Microsoft" button in the React UI.

```jsx
// src/client/App.jsx
const handleLogin = async () => {
    setIsLoading(true);
    setError(null);

    const result = await window.electronAPI.auth.login();

    if (!result.success) {
        setError(result.error || 'Failed to start login');
        setIsLoading(false);
    }
};
```

### Step 2: IPC to Main Process

The preload script bridges the renderer to the main process via IPC.

```javascript
// src/server/preload.js
contextBridge.exposeInMainWorld('electronAPI', {
    auth: {
        login: () => ipcRenderer.invoke('auth:login'),
        // ...
    },
});
```

The IPC handler in main process receives the request:

```javascript
// src/server/ipc/authHandlers.js
ipcMain.handle('auth:login', async () => {
    try {
        return await authController.login();
    } catch (error) {
        return { success: false, error: error.message };
    }
});
```

### Step 3: Generate PKCE Values

PKCE adds security by generating a random `code_verifier` and its SHA256 hash `code_challenge`.

```javascript
// src/server/utils/pkce.js
const crypto = require('node:crypto');

const generatePkce = () => {
    // Random 32-byte string, base64url encoded
    const verifier = crypto.randomBytes(32).toString('base64url');

    // SHA256 hash of verifier, base64url encoded
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

    return { verifier, challenge };
};
```

### Step 4: Build Authorization URL

The auth controller builds the Azure AD authorization URL with PKCE challenge.

```javascript
// src/server/controllers/authController.js
const buildAuthUrl = (codeChallenge) => {
    const params = new URLSearchParams({
        client_id: MSAL_CONFIG.auth.clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,  // msal-electron-poc://auth
        scope: LOGIN_SCOPES.join(' '),
        response_mode: 'query',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });

    return `${MSAL_CONFIG.auth.authority}/oauth2/v2.0/authorize?${params.toString()}`;
};
```

Example URL:
```
https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
  ?client_id=e0189829-a4ed-4372-a66f-28061f994c3a
  &response_type=code
  &redirect_uri=msal-electron-poc://auth
  &scope=User.Read openid profile email
  &response_mode=query
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
```

### Step 5: Open System Browser

The app opens the authorization URL in the system browser.

```javascript
// src/server/controllers/authController.js
const login = async () => {
    const { verifier, challenge } = generatePkce();
    pkceVerifier = verifier;  // Store for later token exchange

    const authUrl = buildAuthUrl(challenge);
    await shell.openExternal(authUrl);  // Opens default browser

    return { success: true };
};
```

### Step 6: User Authenticates

The user completes authentication in their browser:
1. Enters Microsoft credentials
2. Completes MFA if required
3. Consents to permissions (first time only)

### Step 7: Protocol Redirect

After successful authentication, Azure AD redirects to the custom protocol:

```
msal-electron-poc://auth?code=OAQABAAIAAAAm-06blBE...&state=...
```

The OS routes this URL to the Electron app. The app handles it differently based on platform:

**Windows/Linux** - `second-instance` event (app already running):
```javascript
// src/server/main.js
app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
    handleProtocolUrl(url);
    focusMainWindow();
});
```

**macOS** - `open-url` event:
```javascript
// src/server/main.js
app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
});
```

### Step 8: Extract Authorization Code

The auth controller extracts the code from the redirect URL.

```javascript
// src/server/controllers/authController.js
const extractCodeFromUrl = (url) => {
    try {
        return new URL(url).searchParams.get('code');
    } catch (error) {
        console.error('Failed to parse auth URL:', error);
        return null;
    }
};
```

### Step 9: Exchange Code for Tokens

Using MSAL, exchange the authorization code for tokens. The `code_verifier` proves we initiated the request.

```javascript
// src/server/controllers/authController.js
const handleAuthRedirect = async (url) => {
    const code = extractCodeFromUrl(url);

    if (!code || !pkceVerifier) {
        sendToRenderer('auth:error', { message: 'Authentication failed' });
        return;
    }

    try {
        const tokenResponse = await msalClient.acquireTokenByCode({
            code,
            scopes: LOGIN_SCOPES,
            redirectUri: REDIRECT_URI,
            codeVerifier: pkceVerifier,  // PKCE verification
        });

        pkceVerifier = null;  // Clear after use

        authenticatedUser = {
            name: tokenResponse.account?.name || 'Unknown User',
            email: tokenResponse.account?.username || '',
            homeAccountId: tokenResponse.account?.homeAccountId,
        };

        sendToRenderer('auth:success', {
            user: authenticatedUser,
            accessToken: tokenResponse.accessToken,
        });
    } catch (error) {
        sendToRenderer('auth:error', { message: error.message });
    }
};
```

### Step 10: Update UI

The renderer receives the success event and updates the UI.

```javascript
// src/server/preload.js
onAuthSuccess: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('auth:success', handler);
    return () => ipcRenderer.removeListener('auth:success', handler);
},
```

```jsx
// src/client/App.jsx
useEffect(() => {
    const unsubscribe = window.electronAPI.auth.onAuthSuccess((data) => {
        setUser(data.user);
        setIsAuthenticated(true);
        setIsLoading(false);
    });

    return () => unsubscribe();
}, []);
```

## Window Focus Handling

A key requirement is focusing the existing window instead of opening a new one:

```javascript
// src/server/main.js
const focusMainWindow = () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
};
```

This is achieved through single instance lock:

```javascript
// src/server/main.js
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();  // Another instance exists, quit this one
}
```

## Custom Protocol Registration

The protocol must be registered both at runtime and in the packager config.

**Runtime registration:**
```javascript
// src/server/main.js
const registerProtocol = () => {
    if (process.defaultApp && process.argv.length >= 2) {
        // Development: register with electron executable path
        app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
            path.resolve(process.argv[1]),
        ]);
    } else {
        // Production
        app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
    }
};
```

**Packager config (for built apps):**
```javascript
// forge.config.js
packagerConfig: {
    protocols: [
        {
            name: 'MSAL Auth Protocol',
            schemes: ['msal-electron-poc'],
        },
    ],
},
```

## Configuration

Azure AD settings are centralized in the config file:

```javascript
// src/server/config/msalConfig.js
const MSAL_CONFIG = {
    auth: {
        clientId: 'your-client-id',
        authority: 'https://login.microsoftonline.com/your-tenant-id',
    },
};

const REDIRECT_URI = 'msal-electron-poc://auth';
const LOGIN_SCOPES = ['User.Read', 'openid', 'profile', 'email'];
const PROTOCOL_SCHEME = 'msal-electron-poc';
```

## Azure AD App Registration

To configure Azure AD:

1. Go to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations
2. Create a new registration
3. Add a redirect URI:
   - Platform: **Public client/native (mobile & desktop)**
   - URI: `msal-electron-poc://auth`
4. Note the **Application (client) ID** and **Directory (tenant) ID**
5. Under API permissions, ensure `User.Read` is granted

## Security Considerations

| Aspect | Implementation |
|--------|----------------|
| PKCE | Prevents authorization code interception attacks |
| No client secret | Public client - secret would be extractable from desktop app |
| System browser | User sees familiar browser UI, app can't intercept credentials |
| Single instance | Prevents multiple windows from handling auth callback |
| Token storage | In-memory only (not persisted to disk) |
| Preload isolation | Renderer cannot access Node.js APIs directly |

## Logout Flow

Logout clears local state and MSAL token cache:

```javascript
// src/server/controllers/authController.js
const logout = async () => {
    authenticatedUser = null;
    pkceVerifier = null;

    const accounts = await msalClient.getTokenCache().getAllAccounts();
    for (const account of accounts) {
        await msalClient.getTokenCache().removeAccount(account);
    }

    return { success: true };
};
```

## File Structure

```
src/server/
├── main.js                 # App lifecycle, protocol handling
├── preload.js              # IPC bridge to renderer
├── config/
│   └── msalConfig.js       # Azure AD configuration
├── controllers/
│   └── authController.js   # Authentication logic
├── ipc/
│   └── authHandlers.js     # IPC handler registration
└── utils/
    └── pkce.js             # PKCE generation utility
```
