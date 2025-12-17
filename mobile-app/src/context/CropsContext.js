import React, { createContext, useState, useContext, useEffect } from 'react';
import api from '../services/api';

const CropsContext = createContext();

export const useCrops = () => {
  const context = useContext(CropsContext);
  if (!context) {
    throw new Error('useCrops must be used within a CropsProvider');
  }
  return context;
};

export const CropsProvider = ({ children }) => {
  const [crops, setCrops] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  // Cache duration: 5 minutes
  const CACHE_DURATION = 5 * 60 * 1000;

  const fetchCrops = async (forceRefresh = false) => {
    // Use cache if recent and not forcing refresh
    if (!forceRefresh && lastFetch && Date.now() - lastFetch < CACHE_DURATION) {
      return crops;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await api.getCrops();
      setCrops(data);
      setLastFetch(Date.now());
      return data;
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || 'Failed to load crops';
      setError(errorMessage);
      console.error('[CropsContext] Error fetching crops:', err);
      
      // Return cached data if available, even on error
      if (crops.length > 0) {
        console.log('[CropsContext] Using cached crop data after error');
        return crops;
      }
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const refresh = () => fetchCrops(true);

  // Auto-fetch on mount
  useEffect(() => {
    fetchCrops();
  }, []);

  const value = {
    crops,
    isLoading,
    error,
    refresh,
    fetchCrops
  };

  return (
    <CropsContext.Provider value={value}>
      {children}
    </CropsContext.Provider>
  );
};

export default CropsContext;
