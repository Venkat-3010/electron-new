/**
 * Item Model
 * Supports offline-first with sync to MSSQL
 *
 * Sync fields:
 * - uuid: Unique identifier across both databases
 * - syncStatus: 'pending' | 'synced' | 'error'
 * - syncedAt: Last successful sync timestamp
 * - isDeleted: Soft delete flag for sync
 */

const { DataTypes } = require('sequelize');
const crypto = require('crypto');

const defineItemModel = (sequelize, options = {}) => {
    const { forMssql = false } = options;

    const Item = sequelize.define('Item', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        uuid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            unique: true,
            defaultValue: () => crypto.randomUUID(),
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false,
            validate: {
                notEmpty: true,
                len: [1, 255],
            },
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        completed: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        priority: {
            // Use STRING for MSSQL compatibility (ENUM not well supported)
            type: DataTypes.STRING(10),
            defaultValue: 'medium',
            validate: {
                isIn: [['low', 'medium', 'high']],
            },
        },
        // Sync tracking fields (only for SQLite)
        ...(forMssql ? {} : {
            syncStatus: {
                type: DataTypes.STRING(10),
                defaultValue: 'pending',
                validate: {
                    isIn: [['pending', 'synced', 'error']],
                },
            },
            syncedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            isDeleted: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
        }),
    }, {
        tableName: 'items',
        timestamps: true,
        // For SQLite, don't actually delete - mark as deleted for sync
        ...(forMssql ? {} : {
            paranoid: false,
        }),
    });

    return Item;
};

module.exports = { defineItemModel };
