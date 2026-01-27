/**
 * Item Controller
 * Handles CRUD operations on SQLite (offline-first)
 * Items are marked as 'pending' for sync to MSSQL
 */

const { getSqliteItemModel } = require('../database');

/**
 * Get all items (excluding soft-deleted)
 */
const getAllItems = async () => {
    try {
        const Item = getSqliteItemModel();
        const items = await Item.findAll({
            where: { isDeleted: false },
            order: [['createdAt', 'DESC']],
        });
        return { success: true, data: items.map(item => item.toJSON()) };
    } catch (error) {
        console.error('Error fetching items:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Get a single item by ID
 */
const getItemById = async (id) => {
    try {
        const Item = getSqliteItemModel();
        const item = await Item.findOne({
            where: { id, isDeleted: false },
        });
        if (!item) {
            return { success: false, error: 'Item not found' };
        }
        return { success: true, data: item.toJSON() };
    } catch (error) {
        console.error('Error fetching item:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Create a new item
 */
const createItem = async (itemData) => {
    try {
        const Item = getSqliteItemModel();
        const { title, description, priority } = itemData;

        if (!title || title.trim() === '') {
            return { success: false, error: 'Title is required' };
        }

        const item = await Item.create({
            title: title.trim(),
            description: description?.trim() || null,
            priority: priority || 'medium',
            completed: false,
            syncStatus: 'pending', // Mark for sync
            isDeleted: false,
        });

        console.log('Item created:', item.id, '(pending sync)');
        return { success: true, data: item.toJSON() };
    } catch (error) {
        console.error('Error creating item:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Update an existing item
 */
const updateItem = async (id, itemData) => {
    try {
        const Item = getSqliteItemModel();
        const item = await Item.findOne({
            where: { id, isDeleted: false },
        });

        if (!item) {
            return { success: false, error: 'Item not found' };
        }

        const { title, description, priority, completed } = itemData;

        if (title !== undefined) {
            if (title.trim() === '') {
                return { success: false, error: 'Title cannot be empty' };
            }
            item.title = title.trim();
        }

        if (description !== undefined) {
            item.description = description?.trim() || null;
        }

        if (priority !== undefined) {
            item.priority = priority;
        }

        if (completed !== undefined) {
            item.completed = completed;
        }

        // Mark as pending sync
        item.syncStatus = 'pending';

        await item.save();
        console.log('Item updated:', item.id, '(pending sync)');
        return { success: true, data: item.toJSON() };
    } catch (error) {
        console.error('Error updating item:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Delete an item (soft delete for sync)
 */
const deleteItem = async (id) => {
    try {
        const Item = getSqliteItemModel();
        const item = await Item.findOne({
            where: { id, isDeleted: false },
        });

        if (!item) {
            return { success: false, error: 'Item not found' };
        }

        // Soft delete - mark for sync
        await item.update({
            isDeleted: true,
            syncStatus: 'pending',
        });

        console.log('Item soft-deleted:', id, '(pending sync)');
        return { success: true, data: { id } };
    } catch (error) {
        console.error('Error deleting item:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Toggle item completion status
 */
const toggleItemCompleted = async (id) => {
    try {
        const Item = getSqliteItemModel();
        const item = await Item.findOne({
            where: { id, isDeleted: false },
        });

        if (!item) {
            return { success: false, error: 'Item not found' };
        }

        item.completed = !item.completed;
        item.syncStatus = 'pending';
        await item.save();

        console.log('Item toggled:', item.id, 'completed:', item.completed, '(pending sync)');
        return { success: true, data: item.toJSON() };
    } catch (error) {
        console.error('Error toggling item:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    getAllItems,
    getItemById,
    createItem,
    updateItem,
    deleteItem,
    toggleItemCompleted,
};
