/**
 * Database Initialization Module
 *
 * Hybrid database setup:
 * - SQLite: Always initialized (local offline storage)
 * - MSSQL: Initialized when configured and online (remote sync)
 */

const { Sequelize } = require('sequelize');
const { getSqliteConfig, getMssqlConfig, getDbFolderPath, isMssqlConfigured } = require('../config/dbConfig');
const { defineItemModel } = require('./models/Item');
const { defineSessionModel } = require('./models/Session');

// SQLite (local) instances
let sqliteSequelize = null;
let SqliteItem = null;
let SqliteSession = null;

// MSSQL (remote) instances
let mssqlSequelize = null;
let MssqlItem = null;
let MssqlSession = null;
let mssqlConnected = false;

/**
 * Initialize SQLite database (always available)
 */
const initializeSqlite = async () => {
    const config = getSqliteConfig();

    console.log('Initializing SQLite database...');
    console.log('Database folder:', getDbFolderPath());

    sqliteSequelize = new Sequelize(config);

    try {
        await sqliteSequelize.authenticate();
        console.log('SQLite connection established');

        // Define models for SQLite
        SqliteItem = defineItemModel(sqliteSequelize, { forMssql: false });
        SqliteSession = defineSessionModel(sqliteSequelize);

        // Sync tables (use alter to preserve existing data while updating schema)
        await sqliteSequelize.sync({ alter: true });
        console.log('SQLite synchronized');

        return sqliteSequelize;
    } catch (error) {
        console.error('SQLite initialization failed:', error);
        throw error;
    }
};

/**
 * Check if tedious (MSSQL driver) is available
 * In packaged Electron apps, native modules may not be properly resolved
 * We try multiple resolution strategies
 */
const isTediousAvailable = () => {
    // Strategy 1: Try normal require
    try {
        require('tedious');
        console.log('Tedious loaded via standard require');
        return true;
    } catch (error) {
        console.warn('Standard tedious require failed:', error.message);
    }

    // Strategy 2: Try loading from app.asar.unpacked (Electron unpacked modules)
    try {
        const path = require('path');
        const { app } = require('electron');

        if (app && app.isPackaged) {
            // In packaged app, try the unpacked location
            const unpackedPath = path.join(
                path.dirname(app.getPath('exe')),
                'resources',
                'app.asar.unpacked',
                'node_modules',
                'tedious'
            );
            console.log('Trying unpacked tedious path:', unpackedPath);
            require(unpackedPath);
            console.log('Tedious loaded from unpacked path');
            return true;
        }
    } catch (error) {
        console.warn('Unpacked tedious require failed:', error.message);
    }

    console.log('Tedious not available - MSSQL will be disabled');
    return false;
};

/**
 * Initialize MSSQL database (when online and configured)
 */
const initializeMssql = async () => {
    console.log('Checking MSSQL configuration...');

    // First check if tedious driver is available
    if (!isTediousAvailable()) {
        console.log('MSSQL driver (tedious) not available - skipping MSSQL connection');
        console.log('App will continue with SQLite only (offline mode)');
        return null;
    }

    console.log('DB_HOST:', process.env.DB_HOST || '(not set - will use default)');
    console.log('DB_USER:', process.env.DB_USER || '(not set - will use default)');
    console.log('DB_NAME:', process.env.DB_NAME || '(not set - will use default)');

    // Get configuration (uses defaults if env vars not set)
    const config = getMssqlConfig();

    // Skip if host is localhost (means not configured for remote)
    if (config.host === 'localhost') {
        console.log('MSSQL host is localhost - skipping remote database connection');
        return null;
    }

    console.log('Initializing MSSQL database...');
    console.log('MSSQL Host:', config.host);
    console.log('MSSQL Port:', config.port);
    console.log('MSSQL Database:', config.database);
    console.log('MSSQL User:', config.username);

    mssqlSequelize = new Sequelize(
        config.database,
        config.username,
        config.password,
        {
            dialect: 'mssql',
            host: config.host,
            port: config.port,
            logging: config.logging,
            dialectOptions: {
                options: {
                    encrypt: true,
                    trustServerCertificate: true,
                    requestTimeout: 60000,
                    connectionTimeout: 30000,
                },
            },
            pool: config.pool,
        }
    );

    try {
        await mssqlSequelize.authenticate();
        console.log('MSSQL connection established');

        // Define models for MSSQL
        MssqlItem = defineItemModel(mssqlSequelize, { forMssql: true });
        MssqlSession = defineSessionModel(mssqlSequelize);

        // Sync tables for MSSQL
        // Note: MSSQL doesn't support ALTER COLUMN with UNIQUE constraint
        // Use force: false to create tables if they don't exist, without altering
        // For schema changes, use migrations or manually update the database
        await mssqlSequelize.sync({ force: false });
        console.log('MSSQL synchronized');

        mssqlConnected = true;
        return mssqlSequelize;
    } catch (error) {
        console.error('MSSQL initialization failed:', error.message);
        console.error('MSSQL error details:', error.original?.message || error);
        mssqlConnected = false;
        return null;
    }
};

/**
 * Initialize all databases
 */
const initializeDatabase = async () => {
    // Always initialize SQLite
    await initializeSqlite();

    // Try to initialize MSSQL if configured
    await initializeMssql();
};

/**
 * Try to connect to MSSQL (called when coming online)
 */
const connectMssql = async () => {
    if (mssqlConnected) {
        return true;
    }

    try {
        await initializeMssql();
        return mssqlConnected;
    } catch (error) {
        console.error('Failed to connect to MSSQL:', error);
        return false;
    }
};

/**
 * Disconnect from MSSQL (called when going offline)
 */
const disconnectMssql = async () => {
    if (mssqlSequelize) {
        try {
            await mssqlSequelize.close();
        } catch (error) {
            console.error('Error closing MSSQL connection:', error);
        }
        mssqlConnected = false;
    }
};

/**
 * Get SQLite Sequelize instance
 */
const getSqliteSequelize = () => sqliteSequelize;

/**
 * Get MSSQL Sequelize instance
 */
const getMssqlSequelize = () => mssqlSequelize;

/**
 * Get SQLite Item model
 */
const getSqliteItemModel = () => SqliteItem;

/**
 * Get MSSQL Item model
 */
const getMssqlItemModel = () => MssqlItem;

/**
 * Get SQLite Session model
 */
const getSqliteSessionModel = () => SqliteSession;

/**
 * Get MSSQL Session model
 */
const getMssqlSessionModel = () => MssqlSession;

/**
 * Check if MSSQL is connected
 */
const isMssqlConnected = () => mssqlConnected;

/**
 * Close all database connections
 */
const closeDatabase = async () => {
    if (sqliteSequelize) {
        await sqliteSequelize.close();
        sqliteSequelize = null;
        SqliteItem = null;
        console.log('SQLite connection closed');
    }

    if (mssqlSequelize) {
        await mssqlSequelize.close();
        mssqlSequelize = null;
        MssqlItem = null;
        mssqlConnected = false;
        console.log('MSSQL connection closed');
    }
};

module.exports = {
    initializeDatabase,
    initializeSqlite,
    initializeMssql,
    connectMssql,
    disconnectMssql,
    getSqliteSequelize,
    getMssqlSequelize,
    getSqliteItemModel,
    getMssqlItemModel,
    getSqliteSessionModel,
    getMssqlSessionModel,
    isMssqlConnected,
    closeDatabase,
};
