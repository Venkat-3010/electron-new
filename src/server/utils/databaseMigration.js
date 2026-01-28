/**
 * Database Migration Utility
 * 
 * Handles migration from unencrypted SQLite database to encrypted SQLCipher database.
 * This is needed when upgrading from sqlite3 to @journeyapps/sqlcipher.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Check if a database file exists
 * @param {string} dbPath - Path to the database file
 * @returns {boolean} True if database exists
 */
const databaseExists = (dbPath) => {
    return fs.existsSync(dbPath);
};

/**
 * Check if database file has SQLite header (unencrypted)
 * Plain SQLite files start with "SQLite format 3\0"
 * @param {string} dbPath - Path to the database file
 * @returns {boolean} True if database has plain SQLite header
 */
const hasPlainSqliteHeader = (dbPath) => {
    if (!fs.existsSync(dbPath)) {
        return false;
    }

    try {
        const fd = fs.openSync(dbPath, 'r');
        const buffer = Buffer.alloc(16);
        fs.readSync(fd, buffer, 0, 16, 0);
        fs.closeSync(fd);

        // SQLite format 3 header (unencrypted)
        const sqliteHeader = 'SQLite format 3\0';
        const fileHeader = buffer.toString('utf8', 0, 16);

        return fileHeader === sqliteHeader;
    } catch (error) {
        console.error('Error checking database header:', error);
        return false;
    }
};

/**
 * Test if database is readable with given encryption key
 * @param {string} dbPath - Path to the database file
 * @param {string} encryptionKey - The encryption key to test
 * @returns {Promise<boolean>} True if database is readable with this key
 */
const testDatabaseReadable = async (dbPath, encryptionKey) => {
    const sqlcipher = require('@journeyapps/sqlcipher');

    return new Promise((resolve) => {
        const db = new sqlcipher.Database(dbPath, (err) => {
            if (err) {
                console.log('Failed to open database for testing:', err.message);
                resolve(false);
                return;
            }

            db.serialize(() => {
                db.run(`PRAGMA key = '${encryptionKey}'`, (err) => {
                    if (err) {
                        console.log('Failed to set PRAGMA key:', err.message);
                        db.close();
                        resolve(false);
                        return;
                    }

                    db.run(`PRAGMA cipher_compatibility = 4`, (err) => {
                        if (err) {
                            console.log('Failed to set cipher compatibility:', err.message);
                        }

                        db.get(`SELECT count(*) as cnt FROM sqlite_master`, (err, row) => {
                            db.close();
                            if (err) {
                                console.log('Database not readable with key:', err.message);
                                resolve(false);
                            } else {
                                console.log('Database is readable with encryption key');
                                resolve(true);
                            }
                        });
                    });
                });
            });
        });
    });
};

/**
 * Delete corrupted database and allow fresh start
 * @param {string} dbPath - Path to the database file
 * @returns {boolean} True if successfully deleted
 */
const deleteCorruptedDatabase = (dbPath) => {
    try {
        if (fs.existsSync(dbPath)) {
            // Create a backup first
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const corruptedBackupPath = `${dbPath}.corrupted-${timestamp}`;
            fs.renameSync(dbPath, corruptedBackupPath);
            console.log(`Corrupted database moved to: ${corruptedBackupPath}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Failed to delete corrupted database:', error);
        // Try force delete
        try {
            fs.unlinkSync(dbPath);
            return true;
        } catch (e) {
            return false;
        }
    }
};

/**
 * Create a backup of the database file
 * @param {string} dbPath - Path to the database file
 * @returns {string|null} Path to backup file or null if failed
 */
const createBackup = (dbPath) => {
    if (!fs.existsSync(dbPath)) {
        return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.backup-${timestamp}`;

    try {
        fs.copyFileSync(dbPath, backupPath);
        console.log(`Database backup created: ${backupPath}`);
        return backupPath;
    } catch (error) {
        console.error('Failed to create database backup:', error);
        return null;
    }
};

/**
 * Migrate an unencrypted database to encrypted format
 * Uses sqlcipher_export to create an encrypted copy
 * @param {string} dbPath - Path to the unencrypted database
 * @param {string} encryptionKey - The encryption key to use
 * @returns {Promise<boolean>} True if migration successful
 */
const migrateToEncrypted = async (dbPath, encryptionKey) => {
    const sqlcipher = require('@journeyapps/sqlcipher');

    return new Promise((resolve, reject) => {
        // Create backup first
        const backupPath = createBackup(dbPath);
        if (!backupPath) {
            console.warn('Could not create backup, proceeding anyway...');
        }

        const tempEncryptedPath = `${dbPath}.encrypted`;

        // Clean up any leftover temp file
        if (fs.existsSync(tempEncryptedPath)) {
            fs.unlinkSync(tempEncryptedPath);
        }

        // Open the unencrypted database
        const unencryptedDb = new sqlcipher.Database(dbPath, (err) => {
            if (err) {
                console.error('Failed to open unencrypted database:', err);
                reject(err);
                return;
            }

            console.log('Opened unencrypted database for migration');

            // Attach a new encrypted database and export data to it
            unencryptedDb.serialize(() => {
                // Attach the new encrypted database
                unencryptedDb.run(`ATTACH DATABASE '${tempEncryptedPath}' AS encrypted KEY '${encryptionKey}'`, (err) => {
                    if (err) {
                        console.error('Failed to attach encrypted database:', err);
                        unencryptedDb.close();
                        reject(err);
                        return;
                    }

                    // Set cipher compatibility
                    unencryptedDb.run(`PRAGMA encrypted.cipher_compatibility = 4`, (err) => {
                        if (err) {
                            console.warn('Failed to set cipher compatibility:', err);
                        }

                        // Export all data to the encrypted database using sqlcipher_export
                        unencryptedDb.run(`SELECT sqlcipher_export('encrypted')`, (err) => {
                            if (err) {
                                console.error('Failed to export to encrypted database:', err);
                                unencryptedDb.close();
                                reject(err);
                                return;
                            }

                            // Detach the encrypted database
                            unencryptedDb.run(`DETACH DATABASE encrypted`, (err) => {
                                if (err) {
                                    console.warn('Failed to detach encrypted database:', err);
                                }

                                unencryptedDb.close((err) => {
                                    if (err) {
                                        console.warn('Failed to close unencrypted database:', err);
                                    }

                                    // Replace the original with the encrypted version
                                    try {
                                        fs.unlinkSync(dbPath);
                                        fs.renameSync(tempEncryptedPath, dbPath);
                                        console.log('Successfully migrated database to encrypted format');
                                        resolve(true);
                                    } catch (fileErr) {
                                        console.error('Failed to replace database file:', fileErr);
                                        reject(fileErr);
                                    }
                                });
                            });
                        });
                    });
                });
            });
        });
    });
};

/**
 * Prepare database for encrypted access
 * Checks if migration is needed and performs it if necessary
 * Handles corrupted databases by removing them
 * @param {string} dbPath - Path to the database file
 * @param {string} encryptionKey - The encryption key
 * @returns {Promise<{isNew: boolean, wasMigrated: boolean, wasRecovered: boolean}>} Status of preparation
 */
const prepareDatabaseForEncryption = async (dbPath, encryptionKey) => {
    const exists = databaseExists(dbPath);

    if (!exists) {
        console.log('No existing database found, will create new encrypted database');
        return { isNew: true, wasMigrated: false, wasRecovered: false };
    }

    // Check if it has plain SQLite header (unencrypted)
    const hasPlainHeader = hasPlainSqliteHeader(dbPath);

    if (hasPlainHeader) {
        console.log('Existing unencrypted database detected (has SQLite header), starting migration...');
        try {
            await migrateToEncrypted(dbPath, encryptionKey);
            return { isNew: false, wasMigrated: true, wasRecovered: false };
        } catch (error) {
            console.error('Migration failed:', error);
            console.log('Removing corrupted database to allow fresh start...');
            deleteCorruptedDatabase(dbPath);
            return { isNew: true, wasMigrated: false, wasRecovered: true };
        }
    }

    // Database exists but doesn't have plain header - could be encrypted or corrupted
    console.log('Database file exists without plain SQLite header, testing if readable...');

    // Test if we can read it with the encryption key
    const isReadable = await testDatabaseReadable(dbPath, encryptionKey);

    if (isReadable) {
        console.log('Existing encrypted database is readable');
        return { isNew: false, wasMigrated: false, wasRecovered: false };
    }

    // Database exists but is not readable - it's corrupted or encrypted with different key
    console.log('Database is not readable (corrupted or wrong key), removing for fresh start...');
    deleteCorruptedDatabase(dbPath);
    return { isNew: true, wasMigrated: false, wasRecovered: true };
};

module.exports = {
    databaseExists,
    hasPlainSqliteHeader,
    testDatabaseReadable,
    deleteCorruptedDatabase,
    createBackup,
    migrateToEncrypted,
    prepareDatabaseForEncryption,
};
