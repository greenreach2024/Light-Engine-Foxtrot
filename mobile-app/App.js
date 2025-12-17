import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider as PaperProvider, MD3DarkTheme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import SeedTrayScreen from './src/screens/SeedTrayScreen';
import PlaceTrayScreen from './src/screens/PlaceTrayScreen';
import HarvestTrayScreen from './src/screens/HarvestTrayScreen';
import ReportLossScreen from './src/screens/ReportLossScreen';
import EnvironmentScreen from './src/screens/EnvironmentScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

// Context
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { CropsProvider } from './src/context/CropsContext';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#60a5fa',
    secondary: '#34d399',
    background: '#0f172a',
    surface: '#1e293b',
    error: '#ef4444',
  },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Dashboard') iconName = 'view-dashboard';
          else if (route.name === 'Scanner') iconName = 'qrcode-scan';
          else if (route.name === 'Environment') iconName = 'thermometer';
          else if (route.name === 'Notifications') iconName = 'bell';
          else if (route.name === 'Settings') iconName = 'cog';
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#60a5fa',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#1e293b',
          borderTopColor: '#334155',
        },
        headerStyle: {
          backgroundColor: '#1e293b',
        },
        headerTintColor: '#f8fafc',
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Scanner" component={ScannerScreen} />
      <Tab.Screen 
        name="Environment" 
        component={EnvironmentScreen}
        options={{ title: 'Environment' }}
      />
      <Tab.Screen 
        name="Notifications" 
        component={NotificationsScreen}
        options={{ 
          title: 'Alerts',
          tabBarBadge: 2, // Dynamic badge count
        }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { user } = useAuth();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#1e293b',
        },
        headerTintColor: '#f8fafc',
        headerBackTitle: 'Back',
      }}
    >
      {!user ? (
        <Stack.Screen 
          name="Login" 
          component={LoginScreen} 
          options={{ headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen 
            name="Main" 
            component={MainTabs} 
            options={{ headerShown: false }}
          />
          <Stack.Screen 
            name="SeedTray" 
            component={SeedTrayScreen}
            options={{ title: 'Seed New Tray' }}
          />
          <Stack.Screen 
            name="PlaceTray" 
            component={PlaceTrayScreen}
            options={{ title: 'Place Tray' }}
          />
          <Stack.Screen 
            name="HarvestTray" 
            component={HarvestTrayScreen}
            options={{ title: 'Harvest Tray' }}
          />
          <Stack.Screen 
            name="ReportLoss" 
            component={ReportLossScreen}
            options={{ title: 'Report Loss' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <PaperProvider theme={theme}>
      <AuthProvider>
        <CropsProvider>
          <NavigationContainer>
            <AppNavigator />
          </NavigationContainer>
        </CropsProvider>
      </AuthProvider>
    </PaperProvider>
  );
}
