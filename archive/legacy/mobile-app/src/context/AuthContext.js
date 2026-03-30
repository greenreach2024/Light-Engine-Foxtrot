import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [farm, setFarm] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      const storedUser = await AsyncStorage.getItem('user');
      const storedFarm = await AsyncStorage.getItem('farm');
      
      if (token && storedUser && storedFarm) {
        setUser(JSON.parse(storedUser));
        setFarm(JSON.parse(storedFarm));
        api.setAuthToken(token);
      }
    } catch (error) {
      console.error('Error loading auth:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password, farmUrl) => {
    try {
      // Configure API base URL for specific farm
      api.setBaseURL(farmUrl);
      
      // In production, this would call your auth endpoint
      // For now, simulate authentication
      const mockUser = {
        email,
        name: email.split('@')[0],
        farmId: 'farm-001',
      };
      
      const mockToken = 'mock-jwt-token-' + Date.now();
      const mockFarm = {
        url: farmUrl,
        name: 'Main Farm',
        id: 'farm-001',
      };

      await AsyncStorage.setItem('authToken', mockToken);
      await AsyncStorage.setItem('user', JSON.stringify(mockUser));
      await AsyncStorage.setItem('farm', JSON.stringify(mockFarm));
      
      setUser(mockUser);
      setFarm(mockFarm);
      api.setAuthToken(mockToken);
      
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.multiRemove(['authToken', 'user', 'farm']);
      setUser(null);
      setFarm(null);
      api.setAuthToken(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, farm, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
