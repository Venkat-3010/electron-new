/**
 * Session Model
 * Tracks active user sessions for concurrent login limit enforcement
 *
 * Max 3 concurrent sessions per Microsoft account
 */

const { DataTypes } = require('sequelize');
const crypto = require('crypto');

const MAX_CONCURRENT_SESSIONS = 1;

const defineSessionModel = (sequelize) => {
    const Session = sequelize.define('Session', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        sessionId: {
            type: DataTypes.STRING(64),
            allowNull: false,
            unique: true,
            defaultValue: () => crypto.randomBytes(32).toString('hex'),
        },
        // Microsoft account unique identifier (oid from token)
        userId: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        // User email for reference
        userEmail: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        // Device/machine identifier
        deviceId: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        // Device name for display
        deviceName: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        // Last activity timestamp
        lastActiveAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        // Session expiry (matches token expiry)
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        // Is session currently active
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    }, {
        tableName: 'sessions',
        timestamps: true,
        underscored: true,
        indexes: [
            {
                fields: ['user_id'],
            },
            {
                fields: ['session_id'],
            },
            {
                fields: ['device_id'],
            },
        ],
    });

    return Session;
};

module.exports = { defineSessionModel, MAX_CONCURRENT_SESSIONS };
