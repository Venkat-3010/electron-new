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
 * Get MSSQL configuration (remote online database)
 */
const getMssqlConfig = () => ({
    database: process.env.DB_NAME || 'electron_crud_db',
    username: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    dialect: 'mssql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
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
 * Check if MSSQL is configured
 */
const isMssqlConfigured = () => {
    return !!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD);
};

module.exports = {
    setSqlitePath,
    getDbFolderPath,
    getSqliteConfig,
    getMssqlConfig,
    isMssqlConfigured,
};
