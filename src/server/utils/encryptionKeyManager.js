/**
 * Encryption Key Manager
 * 
 * Securely manages the SQLite database encryption key using Windows Credential Manager (keytar).
 * The key is generated once and stored securely, then retrieved for subsequent database operations.
 */

const keytar = require('keytar');
const crypto = require('crypto');

const SERVICE_NAME = 'electron-crud-poc';
const DB_KEY_ACCOUNT = 'sqlite-encryption-key';

/**
 * Generate a secure random encryption key
 * Uses 256-bit (32 bytes) key for AES-256 encryption
 * @returns {string} Hex-encoded encryption key
 */
const generateEncryptionKey = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Get or create the database encryption key
 * - If key exists in keytar, retrieve it
 * - If not, generate a new one and store it securely
 * @returns {Promise<string>} The encryption key
 */
const getOrCreateEncryptionKey = async () => {
    try {
        // Try to retrieve existing key
        let key = await keytar.getPassword(SERVICE_NAME, DB_KEY_ACCOUNT);

        if (key) {
            console.log('Database encryption key retrieved from secure storage');
            return key;
        }

        // Generate new key if none exists
        console.log('Generating new database encryption key...');
        key = generateEncryptionKey();

        // Store the key securely
        await keytar.setPassword(SERVICE_NAME, DB_KEY_ACCOUNT, key);
        console.log('Database encryption key stored in secure storage');

        return key;
    } catch (error) {
        console.error('Error managing encryption key:', error);
        throw new Error('Failed to manage database encryption key: ' + error.message);
    }
};

/**
 * Get the encryption key (throws if not found)
 * @returns {Promise<string|null>} The encryption key or null if not found
 */
const getEncryptionKey = async () => {
    try {
        const key = await keytar.getPassword(SERVICE_NAME, DB_KEY_ACCOUNT);
        return key;
    } catch (error) {
        console.error('Error retrieving encryption key:', error);
        return null;
    }
};

/**
 * Check if an encryption key exists
 * @returns {Promise<boolean>} True if key exists
 */
const hasEncryptionKey = async () => {
    const key = await getEncryptionKey();
    return key !== null;
};

/**
 * Delete the encryption key (WARNING: This will make the database unreadable!)
 * Only use for testing or when intentionally destroying data
 * @returns {Promise<boolean>} True if successfully deleted
 */
const deleteEncryptionKey = async () => {
    try {
        const result = await keytar.deletePassword(SERVICE_NAME, DB_KEY_ACCOUNT);
        if (result) {
            console.log('Database encryption key deleted from secure storage');
        }
        return result;
    } catch (error) {
        console.error('Error deleting encryption key:', error);
        return false;
    }
};

/**
 * Rotate the encryption key (for advanced use cases)
 * Note: This requires re-encrypting the entire database with the new key
 * The caller is responsible for handling the database re-encryption
 * @returns {Promise<{oldKey: string, newKey: string}>} Both keys for migration
 */
const rotateEncryptionKey = async () => {
    try {
        const oldKey = await getEncryptionKey();
        if (!oldKey) {
            throw new Error('No existing encryption key found');
        }

        const newKey = generateEncryptionKey();

        // Store the new key
        await keytar.setPassword(SERVICE_NAME, DB_KEY_ACCOUNT, newKey);
        console.log('Database encryption key rotated');

        return { oldKey, newKey };
    } catch (error) {
        console.error('Error rotating encryption key:', error);
        throw error;
    }
};

module.exports = {
    getOrCreateEncryptionKey,
    getEncryptionKey,
    hasEncryptionKey,
    deleteEncryptionKey,
    rotateEncryptionKey,
    generateEncryptionKey,
};
