import React, { useState, useEffect } from 'react';
import './App.css';

const App = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        // Check if user is already authenticated
        const checkAuth = async () => {
            const currentUser = await window.electronAPI.auth.getUser();
            if (currentUser) {
                setUser(currentUser);
                setIsAuthenticated(true);
            }
        };
        checkAuth();

        // Listen for auth success from main process
        const unsubscribeSuccess = window.electronAPI.auth.onAuthSuccess((data) => {
            console.log('Authentication successful:', data);
            setUser(data.user);
            setIsAuthenticated(true);
            setIsLoading(false);
            setError(null);
        });

        // Listen for auth errors
        const unsubscribeError = window.electronAPI.auth.onAuthError((data) => {
            console.error('Authentication error:', data);
            setError(data.message);
            setIsLoading(false);
        });

        // Cleanup listeners on unmount
        return () => {
            unsubscribeSuccess();
            unsubscribeError();
        };
    }, []);

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);

        const result = await window.electronAPI.auth.login();

        if (!result.success) {
            setError(result.error || 'Failed to start login');
            setIsLoading(false);
        }
        // If successful, browser opens and we wait for auth:success event
    };

    const handleLogout = async () => {
        await window.electronAPI.auth.logout();
        setUser(null);
        setIsAuthenticated(false);
    };

    // Login page
    if (!isAuthenticated) {
        return (
            <div className="login-container">
                <div className="login-card">
                    <h1>Welcome</h1>
                    <p className="subtitle">Sign in to continue</p>

                    {error && (
                        <div className="error-message">
                            {error}
                        </div>
                    )}

                    <button
                        className="login-button"
                        onClick={handleLogin}
                        disabled={isLoading}
                    >
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

                    {isLoading && (
                        <p className="loading-hint">
                            Complete sign-in in your browser...
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // Authenticated view
    return (
        <div className="app-container">
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
                <h1>Welcome, {user?.name?.split(' ')[0]}!</h1>
                <p>You are now signed in. This is where your CRUD application content will go.</p>
            </main>
        </div>
    );
};

export default App;
