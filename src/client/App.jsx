import React, { useState, useEffect } from 'react';
import './App.css';

const App = () => {
    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [accessToken, setAccessToken] = useState(null);
    const [tokenExpiresOn, setTokenExpiresOn] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Items state
    const [items, setItems] = useState([]);
    const [itemsLoading, setItemsLoading] = useState(false);
    const [formData, setFormData] = useState({ title: '', description: '', priority: 'medium' });
    const [editingId, setEditingId] = useState(null);
    const [filter, setFilter] = useState('all'); // all, active, completed

    // Network status state
    const [isOnline, setIsOnline] = useState(true);
    const [showNetworkNotification, setShowNetworkNotification] = useState(false);

    // Sync status state
    const [syncStatus, setSyncStatus] = useState({ pending: 0, synced: 0, error: 0, isMssqlConnected: false });
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState(null);

    // Session management state
    const [showMaxSessionsModal, setShowMaxSessionsModal] = useState(false);
    const [maxSessionsInfo, setMaxSessionsInfo] = useState(null);

    // Update state
    const [appVersion, setAppVersion] = useState('');
    const [updateStatus, setUpdateStatus] = useState('idle'); // idle, checking, available, downloading, downloaded, error
    const [updateInfo, setUpdateInfo] = useState(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [updateError, setUpdateError] = useState(null);

    // Auth effects
    useEffect(() => {
        const checkAuth = async () => {
            const currentUser = await window.electronAPI.auth.getUser();
            if (currentUser) {
                setUser(currentUser);
                setIsAuthenticated(true);
            }
        };
        checkAuth();

        const unsubscribeSuccess = window.electronAPI.auth.onAuthSuccess((data) => {
            setUser(data.user);
            setAccessToken(data.accessToken);
            setTokenExpiresOn(data.expiresOn);
            setIsAuthenticated(true);
            setIsLoading(false);
            setError(null);
        });

        const unsubscribeError = window.electronAPI.auth.onAuthError((data) => {
            setError(data.message);
            setIsLoading(false);
        });

        const unsubscribeMaxSessions = window.electronAPI.auth.onMaxSessions((data) => {
            setIsLoading(false);
            setMaxSessionsInfo(data);
            setShowMaxSessionsModal(true);
        });

        return () => {
            unsubscribeSuccess();
            unsubscribeError();
            unsubscribeMaxSessions();
        };
    }, []);

    // Network status effect
    useEffect(() => {
        // Get initial network status
        const getInitialStatus = async () => {
            const result = await window.electronAPI.network.getStatus();
            setIsOnline(result.isOnline);
        };
        getInitialStatus();

        // Listen for network status changes
        const unsubscribe = window.electronAPI.network.onStatusChange((data) => {
            setIsOnline(data.isOnline);
            setShowNetworkNotification(true);

            // Auto-hide notification after 3 seconds
            setTimeout(() => {
                setShowNetworkNotification(false);
            }, 3000);
        });

        return () => unsubscribe();
    }, []);

    // Sync status effect
    useEffect(() => {
        // Get initial sync status
        const getSyncStatus = async () => {
            const result = await window.electronAPI.sync.getStatus();
            setSyncStatus(result);
        };
        getSyncStatus();

        // Listen for sync status changes
        const unsubscribe = window.electronAPI.sync.onStatusChange((data) => {
            if (data.status === 'syncing') {
                setIsSyncing(true);
                setSyncMessage('Syncing...');
            } else if (data.status === 'completed') {
                setIsSyncing(false);
                setSyncMessage(`Sync completed: ${data.syncedCount || 0} items synced`);
                // Refresh sync status
                getSyncStatus();
                // Reload items to get any pulled changes
                if (isAuthenticated) {
                    loadItems();
                }
                // Clear message after 3 seconds
                setTimeout(() => setSyncMessage(null), 3000);
            } else if (data.status === 'error') {
                setIsSyncing(false);
                setSyncMessage(`Sync error: ${data.message}`);
                setTimeout(() => setSyncMessage(null), 5000);
            }
        });

        return () => unsubscribe();
    }, [isAuthenticated]);

    // Update effect - listen for auto-update events
    useEffect(() => {
        // Get current app version
        const getVersion = async () => {
            const result = await window.electronAPI.update.getVersion();
            setAppVersion(result.version);
        };
        getVersion();

        // Listen for update available
        const unsubAvailable = window.electronAPI.update.onUpdateAvailable((data) => {
            setUpdateStatus('available');
            setUpdateInfo(data);
        });

        // Listen for no update available
        const unsubNotAvailable = window.electronAPI.update.onUpdateNotAvailable(() => {
            setUpdateStatus('idle');
        });

        // Listen for download progress
        const unsubProgress = window.electronAPI.update.onDownloadProgress((data) => {
            setUpdateStatus('downloading');
            setDownloadProgress(data.percent);
        });

        // Listen for update downloaded
        const unsubDownloaded = window.electronAPI.update.onUpdateDownloaded((data) => {
            setUpdateStatus('downloaded');
            setUpdateInfo(data);
        });

        // Listen for update error
        const unsubError = window.electronAPI.update.onUpdateError((data) => {
            setUpdateStatus('error');
            setUpdateError(data.message);
            // Clear error after 5 seconds
            setTimeout(() => {
                setUpdateStatus('idle');
                setUpdateError(null);
            }, 5000);
        });

        return () => {
            unsubAvailable();
            unsubNotAvailable();
            unsubProgress();
            unsubDownloaded();
            unsubError();
        };
    }, []);

    // Load items when authenticated
    useEffect(() => {
        if (isAuthenticated) {
            loadItems();
        }
    }, [isAuthenticated]);

    const loadItems = async () => {
        setItemsLoading(true);
        const result = await window.electronAPI.items.getAll();
        if (result.success) {
            setItems(result.data);
        } else {
            setError(result.error);
        }
        setItemsLoading(false);
        // Also refresh sync status
        const syncResult = await window.electronAPI.sync.getStatus();
        setSyncStatus(syncResult);
    };

    const handleManualSync = async () => {
        if (isSyncing || !isOnline) return;
        setIsSyncing(true);
        setSyncMessage('Syncing...');
        const result = await window.electronAPI.sync.trigger();
        if (result.success) {
            setSyncMessage(`Sync completed: ${result.pushed?.syncedCount || 0} pushed, ${result.pulled?.pulledCount || 0} pulled`);
            loadItems();
        } else {
            setSyncMessage(`Sync failed: ${result.reason || result.error}`);
        }
        setIsSyncing(false);
        setTimeout(() => setSyncMessage(null), 3000);
    };

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);
        const result = await window.electronAPI.auth.login();
        if (!result.success) {
            setError(result.error || 'Failed to start login');
            setIsLoading(false);
        }
    };

    const handleForceLogin = async () => {
        setIsLoading(true);
        setShowMaxSessionsModal(false);
        const result = await window.electronAPI.auth.forceLogin();
        if (result.success) {
            setUser(result.user);
            setAccessToken(result.accessToken);
            setIsAuthenticated(true);
            setError(null);
        } else {
            setError(result.error || 'Failed to force login');
        }
        setIsLoading(false);
    };

    const handleCancelMaxSessions = () => {
        setShowMaxSessionsModal(false);
        setMaxSessionsInfo(null);
    };

    const handleLogout = async () => {
        await window.electronAPI.auth.logout();
        setUser(null);
        setAccessToken(null);
        setTokenExpiresOn(null);
        setIsAuthenticated(false);
        setItems([]);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.title.trim()) return;

        if (editingId) {
            const result = await window.electronAPI.items.update(editingId, formData);
            if (result.success) {
                setItems(items.map(item => item.id === editingId ? result.data : item));
                setEditingId(null);
            } else {
                setError(result.error);
            }
        } else {
            const result = await window.electronAPI.items.create(formData);
            if (result.success) {
                setItems([result.data, ...items]);
            } else {
                setError(result.error);
            }
        }
        setFormData({ title: '', description: '', priority: 'medium' });
    };

    const handleEdit = (item) => {
        setEditingId(item.id);
        setFormData({
            title: item.title,
            description: item.description || '',
            priority: item.priority,
        });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setFormData({ title: '', description: '', priority: 'medium' });
    };

    const handleDelete = async (id) => {
        const result = await window.electronAPI.items.delete(id);
        if (result.success) {
            setItems(items.filter(item => item.id !== id));
        } else {
            setError(result.error);
        }
    };

    const handleToggle = async (id) => {
        const result = await window.electronAPI.items.toggle(id);
        if (result.success) {
            setItems(items.map(item => item.id === id ? result.data : item));
        } else {
            setError(result.error);
        }
    };

    const filteredItems = items.filter(item => {
        if (filter === 'active') return !item.completed;
        if (filter === 'completed') return item.completed;
        return true;
    });

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'high': return '#e74c3c';
            case 'medium': return '#f39c12';
            case 'low': return '#27ae60';
            default: return '#95a5a6';
        }
    };

    // Update handlers
    const handleCheckForUpdates = async () => {
        setUpdateStatus('checking');
        setUpdateError(null);
        await window.electronAPI.update.check();
    };

    const handleDownloadUpdate = async () => {
        setDownloadProgress(0);
        await window.electronAPI.update.download();
    };

    const handleInstallUpdate = () => {
        window.electronAPI.update.install();
    };

    const dismissUpdate = () => {
        setUpdateStatus('idle');
        setUpdateInfo(null);
    };

    // Network status indicator component
    const NetworkIndicator = () => (
        <>
            {/* Persistent status indicator */}
            <div className={`network-indicator ${isOnline ? 'online' : 'offline'}`}>
                <span className="network-dot"></span>
                <span className="network-text">{isOnline ? 'Online' : 'Offline'}</span>
            </div>

            {/* Toast notification on status change */}
            {showNetworkNotification && (
                <div className={`network-toast ${isOnline ? 'online' : 'offline'}`}>
                    <span className="network-toast-icon">{isOnline ? '✓' : '✕'}</span>
                    <span>{isOnline ? 'You are back online' : 'You are offline'}</span>
                </div>
            )}
        </>
    );

    // Max sessions modal component
    const MaxSessionsModal = () => {
        if (!showMaxSessionsModal || !maxSessionsInfo) return null;

        return (
            <div className="modal-overlay">
                <div className="modal-content">
                    <h2>Maximum Sessions Reached</h2>
                    <p className="modal-message">
                        You have reached the maximum of {maxSessionsInfo.maxSessions} concurrent sessions.
                    </p>

                    <div className="sessions-list">
                        <h3>Active Sessions:</h3>
                        {maxSessionsInfo.existingSessions?.map((session, index) => (
                            <div key={index} className="session-item">
                                <span className="session-device">{session.deviceName}</span>
                                <span className="session-date">
                                    Started: {new Date(session.createdAt).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>

                    <p className="modal-warning">
                        Would you like to sign out from the oldest session and continue?
                    </p>

                    <div className="modal-actions">
                        <button className="btn btn-primary" onClick={handleForceLogin}>
                            Sign out oldest & continue
                        </button>
                        <button className="btn btn-secondary" onClick={handleCancelMaxSessions}>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Sync status indicator component
    const SyncIndicator = () => (
        <div className="sync-indicator">
            {syncStatus.pending > 0 && (
                <span className="sync-badge pending" title="Pending sync">
                    {syncStatus.pending} pending
                </span>
            )}
            {syncStatus.error > 0 && (
                <span className="sync-badge error" title="Sync errors">
                    {syncStatus.error} errors
                </span>
            )}
            {syncStatus.isMssqlConnected && (
                <span className="sync-badge connected" title="Connected to MSSQL">
                    MSSQL
                </span>
            )}
            <button
                className={`sync-button ${isSyncing ? 'syncing' : ''}`}
                onClick={handleManualSync}
                disabled={isSyncing || !isOnline}
                title={!isOnline ? 'Offline - cannot sync' : 'Sync now'}
            >
                {isSyncing ? '⟳' : '↻'} Sync
            </button>
            {syncMessage && (
                <span className="sync-message">{syncMessage}</span>
            )}
        </div>
    );

    // Update notification component
    const UpdateNotification = () => {
        if (updateStatus === 'idle' || updateStatus === 'checking') return null;

        return (
            <div className={`update-notification ${updateStatus}`}>
                {updateStatus === 'available' && (
                    <>
                        <div className="update-content">
                            <span className="update-icon">🎉</span>
                            <div className="update-text">
                                <strong>Update available!</strong>
                                <span>Version {updateInfo?.version} is ready to download</span>
                            </div>
                        </div>
                        <div className="update-actions">
                            <button className="btn btn-primary btn-sm" onClick={handleDownloadUpdate}>
                                Download
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={dismissUpdate}>
                                Later
                            </button>
                        </div>
                    </>
                )}

                {updateStatus === 'downloading' && (
                    <>
                        <div className="update-content">
                            <span className="update-icon">⬇️</span>
                            <div className="update-text">
                                <strong>Downloading update...</strong>
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{ width: `${downloadProgress}%` }}
                                    />
                                </div>
                                <span>{downloadProgress.toFixed(0)}%</span>
                            </div>
                        </div>
                    </>
                )}

                {updateStatus === 'downloaded' && (
                    <>
                        <div className="update-content">
                            <span className="update-icon">✅</span>
                            <div className="update-text">
                                <strong>Update ready!</strong>
                                <span>Version {updateInfo?.version} will install on restart</span>
                            </div>
                        </div>
                        <div className="update-actions">
                            <button className="btn btn-primary btn-sm" onClick={handleInstallUpdate}>
                                Restart Now
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={dismissUpdate}>
                                Later
                            </button>
                        </div>
                    </>
                )}

                {updateStatus === 'error' && (
                    <>
                        <div className="update-content">
                            <span className="update-icon">❌</span>
                            <div className="update-text">
                                <strong>Update error</strong>
                                <span>{updateError}</span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        );
    };

    // Login page
    if (!isAuthenticated) {
        return (
            <div className="login-container">
                <NetworkIndicator />
                <UpdateNotification />
                <MaxSessionsModal />
                <div className="login-card">
                    <h1>Welcome</h1>
                    <p className="subtitle">Sign in to continue</p>

                    {error && <div className="error-message">{error}</div>}

                    <button className="login-button" onClick={handleLogin} disabled={isLoading}>
                        {isLoading ? (
                            <>
                                <span className="spinner"></span>
                                Signing in...
                            </>
                        ) : (
                            <>
                                <svg className="microsoft-icon" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                                    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                                    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                                </svg>
                                Sign in with Microsoft
                            </>
                        )}
                    </button>

                    {isLoading && <p className="loading-hint">Complete sign-in in your browser...</p>}
                </div>
            </div>
        );
    }

    // Authenticated view with CRUD
    return (
        <div className="app-container">
            <NetworkIndicator />
            <UpdateNotification />
            <SyncIndicator />
            <header className="app-header">
                <div className="user-info">
                    <div className="user-avatar">
                        {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                    <div className="user-details">
                        <span className="user-name">{user?.name}</span>
                        <span className="user-email">{user?.email}</span>
                    </div>
                </div>
                <button className="logout-button" onClick={handleLogout}>
                    Sign out
                </button>
            </header>

            <main className="app-main">
                <h1>Task Manager</h1>

                {error && (
                    <div className="error-message" style={{ marginBottom: '1rem' }}>
                        {error}
                        <button onClick={() => setError(null)} style={{ marginLeft: '1rem' }}>Dismiss</button>
                    </div>
                )}

                {/* Add/Edit Form */}
                <form className="item-form" onSubmit={handleSubmit}>
                    <div className="form-row">
                        <input
                            type="text"
                            placeholder="Task title..."
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="form-input"
                        />
                        <select
                            value={formData.priority}
                            onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                            className="form-select"
                        >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                    <textarea
                        placeholder="Description (optional)..."
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="form-textarea"
                        rows={2}
                    />
                    <div className="form-actions">
                        <button type="submit" className="btn btn-primary">
                            {editingId ? 'Update Task' : 'Add Task'}
                        </button>
                        {editingId && (
                            <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>
                                Cancel
                            </button>
                        )}
                    </div>
                </form>

                {/* Filter Tabs */}
                <div className="filter-tabs">
                    <button
                        className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
                        onClick={() => setFilter('all')}
                    >
                        All ({items.length})
                    </button>
                    <button
                        className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
                        onClick={() => setFilter('active')}
                    >
                        Active ({items.filter(i => !i.completed).length})
                    </button>
                    <button
                        className={`filter-tab ${filter === 'completed' ? 'active' : ''}`}
                        onClick={() => setFilter('completed')}
                    >
                        Completed ({items.filter(i => i.completed).length})
                    </button>
                </div>

                {/* Items List */}
                {itemsLoading ? (
                    <div className="loading">Loading tasks...</div>
                ) : filteredItems.length === 0 ? (
                    <div className="empty-state">
                        {filter === 'all' ? 'No tasks yet. Add one above!' : `No ${filter} tasks.`}
                    </div>
                ) : (
                    <ul className="items-list">
                        {filteredItems.map(item => (
                            <li key={item.id} className={`item ${item.completed ? 'completed' : ''}`}>
                                <div className="item-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={item.completed}
                                        onChange={() => handleToggle(item.id)}
                                    />
                                </div>
                                <div className="item-content">
                                    <div className="item-header">
                                        <span className="item-title">{item.title}</span>
                                        <span
                                            className="item-priority"
                                            style={{ backgroundColor: getPriorityColor(item.priority) }}
                                        >
                                            {item.priority}
                                        </span>
                                    </div>
                                    {item.description && (
                                        <p className="item-description">{item.description}</p>
                                    )}
                                </div>
                                <div className="item-actions">
                                    <button className="btn-icon" onClick={() => handleEdit(item)} title="Edit">
                                        ✏️
                                    </button>
                                    <button className="btn-icon" onClick={() => handleDelete(item.id)} title="Delete">
                                        🗑️
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </main>
        </div>
    );
};

export default App;
