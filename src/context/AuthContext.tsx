import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loginUser, getCurrentUser, logout as logoutAction, clearError } from '../store/slices/authSlice';
import { User } from '../types';
import socketService from '../services/socket';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, captchaToken?: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isOperator: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const dispatch = useAppDispatch();
  const { user, loading, error } = useAppSelector((state) => state.auth);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      dispatch(getCurrentUser());
    }
  }, []);

  useEffect(() => {
    // Connect to socket when user is authenticated
    if (user) {
      socketService.connect();
    } else {
      socketService.disconnect();
    }
  }, [user]);


  const login = async (username: string, password: string, captchaToken?: string) => {
    const result = await dispatch(loginUser({ username, password, captchaToken }));
    if (loginUser.rejected.match(result)) {
      throw new Error(result.error.message || 'Login failed');
    }
  };

  const logout = () => {
    dispatch(logoutAction());
    socketService.disconnect();
  };

  const value = {
    user,
    loading,
    login,
    logout,
    isAdmin: user?.role === 'admin',
    isOperator: user?.role === 'operator',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};