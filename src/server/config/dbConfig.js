/**
 * Database Configuration for Hybrid SQLite + MSSQL
 *
 * Architecture:
 * - SQLite: Local offline storage (always available)
 * - MSSQL: Remote server storage (sync when online)
 *
 * Data flow:
 * - All CRUD operations happen on SQLite first (offline-first)
 * - When online, data syncs to MSSQL
 */

// SQLite config - path will be set at runtime from main.js
let sqlitePath = null;
let dbFolderPath = null;

/**
 * Set the SQLite database file path
 * Called from main.js after app is ready
 */
const setSqlitePath = (filePath, folderPath) => {
    sqlitePath = filePath;
    dbFolderPath = folderPath;
};

/**
 * Get the database folder path (for console logging)
 */
const getDbFolderPath = () => dbFolderPath;

/**
 * Get SQLite configuration (local offline database)
 */
const getSqliteConfig = () => ({
    dialect: 'sqlite',
    storage: sqlitePath,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    define: {
        timestamps: true,
        underscored: true,
    },
});

/**
 * Default MSSQL configuration values
 * These are used when environment variables are not set
 */
const MSSQL_DEFAULTS = {
    host: 'electron-db.database.windows.net',
    database: 'electron_crud_db',
    username: 'electronAdmin',
    password: 'Test@123',
    port: 1433,
};

/**
 * Get MSSQL configuration (remote online database)
 * Uses environment variables with fallback to defaults
 */
const getMssqlConfig = () => ({
    database: process.env.DB_NAME || MSSQL_DEFAULTS.database,
    username: process.env.DB_USER || MSSQL_DEFAULTS.username,
    password: process.env.DB_PASSWORD || MSSQL_DEFAULTS.password,
    dialect: 'mssql',
    host: process.env.DB_HOST || MSSQL_DEFAULTS.host,
    port: parseInt(process.env.DB_PORT, 10) || MSSQL_DEFAULTS.port,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: {
        options: {
            encrypt: true,
            trustServerCertificate: true,
        },
    },
    define: {
        timestamps: true,
        underscored: true,
    },
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000,
    },
});

/**
 * Check if MSSQL is configured for remote connection
 * Returns true if host is set to something other than localhost
 */
const isMssqlConfigured = () => {
    const host = process.env.DB_HOST || MSSQL_DEFAULTS.host;
    // Consider configured if host is not localhost (i.e., pointing to remote server)
    return host !== 'localhost';
};

module.exports = {
    setSqlitePath,
    getDbFolderPath,
    getSqliteConfig,
    getMssqlConfig,
    isMssqlConfigured,
};
