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

        // Sync tables
        await sqliteSequelize.sync({ force: true });
        console.log('SQLite synchronized');

        return sqliteSequelize;
    } catch (error) {
        console.error('SQLite initialization failed:', error);
        throw error;
    }
};

/**
 * Initialize MSSQL database (when online and configured)
 */
const initializeMssql = async () => {
    console.log('Checking MSSQL configuration...');
    console.log('DB_HOST:', process.env.DB_HOST);
    console.log('DB_USER:', process.env.DB_USER);
    console.log('DB_NAME:', process.env.DB_NAME);

    if (!isMssqlConfigured()) {
        console.log('MSSQL not configured - skipping (need DB_HOST, DB_USER, and DB_PASSWORD)');
        return null;
    }

    const config = getMssqlConfig();

    console.log('Initializing MSSQL database...');
    console.log('MSSQL Host:', config.host);
    console.log('MSSQL Port:', config.port);
    console.log('MSSQL Database:', config.database);

    mssqlSequelize = new Sequelize(
        process.env.DB_NAME || 'electron_crud_db',
        process.env.DB_USER || '',
        process.env.DB_PASSWORD || '',
        {
            dialect: 'mssql',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT, 10) || 1433,
            logging: process.env.NODE_ENV === 'development' ? console.log : false,
            dialectOptions: {
                options: {
                    encrypt: true,
                    trustServerCertificate: true,
                    requestTimeout: 60000,
                    connectionTimeout: 30000,
                },
            },
        }
    );

    try {
        await mssqlSequelize.authenticate();
        console.log('MSSQL connection established');

        // Define models for MSSQL
        MssqlItem = defineItemModel(mssqlSequelize, { forMssql: true });
        MssqlSession = defineSessionModel(mssqlSequelize);

        // Sync tables
        await mssqlSequelize.sync({ force: true });
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
