/**
 * Session Service
 * Manages user sessions and enforces concurrent session limits
 *
 * Max 3 concurrent sessions per Microsoft account
 */

const { Op } = require('sequelize');
const crypto = require('crypto');
const os = require('os');
const { getSqliteSessionModel, getMssqlSessionModel, isMssqlConnected } = require('../database');
const { MAX_CONCURRENT_SESSIONS } = require('../database/models/Session');

// Device ID is unique per installation
let deviceId = null;

/**
 * Get or generate device ID for this installation
 */
const getDeviceId = () => {
    if (deviceId) return deviceId;

    // Create a device ID based on machine characteristics
    const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}`;
    deviceId = crypto.createHash('sha256').update(machineId).digest('hex').substring(0, 32);

    return deviceId;
};

/**
 * Get device name for display
 */
const getDeviceName = () => {
    return `${os.hostname()} (${os.platform()})`;
};

/**
 * Get the session model (prefers MSSQL for cross-device enforcement, falls back to SQLite)
 */
const getSessionModel = () => {
    if (isMssqlConnected()) {
        const MssqlSession = getMssqlSessionModel();
        if (MssqlSession) return MssqlSession;
    }
    return getSqliteSessionModel();
};

/**
 * Clean up expired sessions
 */
const cleanupExpiredSessions = async () => {
    const Session = getSessionModel();
    if (!Session) return;

    try {
        await Session.destroy({
            where: {
                [Op.or]: [
                    { expiresAt: { [Op.lt]: new Date() } },
                    { isActive: false },
                ],
            },
        });
    } catch (error) {
        console.error('Error cleaning up sessions:', error);
    }
};

/**
 * Get active sessions count for a user
 */
const getActiveSessionCount = async (userId) => {
    const Session = getSessionModel();
    if (!Session) return 0;

    await cleanupExpiredSessions();

    return await Session.count({
        where: {
            userId,
            isActive: true,
            expiresAt: { [Op.gt]: new Date() },
        },
    });
};

/**
 * Get all active sessions for a user
 */
const getActiveSessions = async (userId) => {
    const Session = getSessionModel();
    if (!Session) return [];

    await cleanupExpiredSessions();

    const sessions = await Session.findAll({
        where: {
            userId,
            isActive: true,
            expiresAt: { [Op.gt]: new Date() },
        },
        order: [['createdAt', 'ASC']],
    });

    return sessions.map(s => ({
        sessionId: s.sessionId,
        deviceId: s.deviceId,
        deviceName: s.deviceName,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        isCurrentDevice: s.deviceId === getDeviceId(),
    }));
};

/**
 * Check if user can create a new session
 * Returns { allowed: boolean, activeSessions: number, mustRemove?: Session[] }
 */
const canCreateSession = async (userId) => {
    const activeCount = await getActiveSessionCount(userId);

    if (activeCount < MAX_CONCURRENT_SESSIONS) {
        return { allowed: true, activeSessions: activeCount };
    }

    // Get oldest sessions to potentially remove
    const Session = getSessionModel();
    const oldestSessions = await Session.findAll({
        where: {
            userId,
            isActive: true,
            expiresAt: { [Op.gt]: new Date() },
        },
        order: [['createdAt', 'ASC']],
        limit: activeCount - MAX_CONCURRENT_SESSIONS + 1,
    });

    return {
        allowed: false,
        activeSessions: activeCount,
        maxSessions: MAX_CONCURRENT_SESSIONS,
        oldestSessions: oldestSessions.map(s => ({
            sessionId: s.sessionId,
            deviceName: s.deviceName,
            createdAt: s.createdAt,
        })),
    };
};

/**
 * Create a new session for the user
 * Will fail if max sessions exceeded (unless forceCreate is true, which removes oldest)
 */
const createSession = async (userId, userEmail, expiresAt, forceCreate = false) => {
    const Session = getSessionModel();
    if (!Session) {
        return { success: false, error: 'Session storage not available' };
    }

    const canCreate = await canCreateSession(userId);

    if (!canCreate.allowed) {
        if (forceCreate) {
            // Remove oldest session(s) to make room
            const sessionsToRemove = canCreate.oldestSessions || [];
            for (const session of sessionsToRemove) {
                await Session.update(
                    { isActive: false },
                    { where: { sessionId: session.sessionId } }
                );
                console.log(`Removed old session: ${session.sessionId} (${session.deviceName})`);
            }
        } else {
            return {
                success: false,
                error: 'max_sessions_exceeded',
                message: `Maximum ${MAX_CONCURRENT_SESSIONS} concurrent sessions allowed`,
                activeSessions: canCreate.activeSessions,
                maxSessions: MAX_CONCURRENT_SESSIONS,
                existingSessions: canCreate.oldestSessions,
            };
        }
    }

    // Check if this device already has a session for this user
    const existingSession = await Session.findOne({
        where: {
            userId,
            deviceId: getDeviceId(),
            isActive: true,
        },
    });

    if (existingSession) {
        // Update existing session
        await existingSession.update({
            expiresAt,
            lastActiveAt: new Date(),
        });
        console.log(`Updated existing session for device: ${getDeviceName()}`);
        return { success: true, sessionId: existingSession.sessionId, updated: true };
    }

    // Create new session
    const newSession = await Session.create({
        userId,
        userEmail,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
        expiresAt,
        lastActiveAt: new Date(),
    });

    console.log(`Created new session: ${newSession.sessionId} for device: ${getDeviceName()}`);
    return { success: true, sessionId: newSession.sessionId, created: true };
};

/**
 * Validate a session is still active
 */
const validateSession = async (sessionId) => {
    const Session = getSessionModel();
    if (!Session) return false;

    const session = await Session.findOne({
        where: {
            sessionId,
            isActive: true,
            expiresAt: { [Op.gt]: new Date() },
        },
    });

    if (session) {
        // Update last active timestamp
        await session.update({ lastActiveAt: new Date() });
        return true;
    }

    return false;
};

/**
 * Get session for current device
 */
const getCurrentDeviceSession = async (userId) => {
    const Session = getSessionModel();
    if (!Session) return null;

    return await Session.findOne({
        where: {
            userId,
            deviceId: getDeviceId(),
            isActive: true,
            expiresAt: { [Op.gt]: new Date() },
        },
    });
};

/**
 * End a specific session
 */
const endSession = async (sessionId) => {
    const Session = getSessionModel();
    if (!Session) return false;

    const result = await Session.update(
        { isActive: false },
        { where: { sessionId } }
    );

    return result[0] > 0;
};

/**
 * End all sessions for the current device
 */
const endCurrentDeviceSession = async (userId) => {
    const Session = getSessionModel();
    if (!Session) return false;

    const result = await Session.update(
        { isActive: false },
        { where: { userId, deviceId: getDeviceId() } }
    );

    return result[0] > 0;
};

/**
 * End all sessions for a user (logout from all devices)
 */
const endAllSessions = async (userId) => {
    const Session = getSessionModel();
    if (!Session) return false;

    const result = await Session.update(
        { isActive: false },
        { where: { userId } }
    );

    return result[0] > 0;
};

/**
 * Update session expiry (called when token is refreshed)
 */
const updateSessionExpiry = async (userId, newExpiresAt) => {
    const Session = getSessionModel();
    if (!Session) return false;

    const result = await Session.update(
        {
            expiresAt: newExpiresAt,
            lastActiveAt: new Date(),
        },
        {
            where: {
                userId,
                deviceId: getDeviceId(),
                isActive: true,
            },
        }
    );

    return result[0] > 0;
};

module.exports = {
    getDeviceId,
    getDeviceName,
    getActiveSessionCount,
    getActiveSessions,
    canCreateSession,
    createSession,
    validateSession,
    getCurrentDeviceSession,
    endSession,
    endCurrentDeviceSession,
    endAllSessions,
    updateSessionExpiry,
    cleanupExpiredSessions,
    MAX_CONCURRENT_SESSIONS,
};
