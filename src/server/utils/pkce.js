const crypto = require('node:crypto');

/**
 * Generate PKCE code verifier and challenge for OAuth 2.0
 * @returns {{ verifier: string, challenge: string }}
 */
function generatePkce() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

    return { verifier, challenge };
}

module.exports = { generatePkce };
