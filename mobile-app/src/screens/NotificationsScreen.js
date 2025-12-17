import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Text, Card, List, Switch, ActivityIndicator, Chip, Badge } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function NotificationsScreen({ navigation }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [preferences, setPreferences] = useState({
    harvestReminders: true,
    anomalyAlerts: true,
    deviceOffline: true,
    lowInventory: false,
    dailySummary: true,
  });
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [notifs, prefs] = await Promise.all([
        api.getNotifications(),
        loadPreferences(),
      ]);
      setNotifications(notifs || []);
      setPreferences(prefs);
      setUnreadCount(notifs.filter((n) => !n.read).length);
    } catch (err) {
      console.error('Load notifications error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadPreferences = async () => {
    try {
      const stored = await AsyncStorage.getItem('notificationPrefs');
      return stored ? JSON.parse(stored) : preferences;
    } catch (err) {
      return preferences;
    }
  };

  const savePreferences = async (newPrefs) => {
    try {
      await AsyncStorage.setItem('notificationPrefs', JSON.stringify(newPrefs));
      setPreferences(newPrefs);
      // TODO: Sync with backend
      // await api.updateNotificationPreferences(newPrefs);
    } catch (err) {
      console.error('Save preferences error:', err);
    }
  };

  const togglePreference = (key) => {
    const newPrefs = { ...preferences, [key]: !preferences[key] };
    savePreferences(newPrefs);
  };

  const markAsRead = async (notificationId) => {
    try {
      await api.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Mark all read error:', err);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const getNotificationIcon = (type) => {
    const icons = {
      harvest: 'basket',
      anomaly: 'alert-circle',
      device: 'connection',
      inventory: 'package-variant',
      system: 'information',
    };
    return icons[type] || 'bell';
  };

  const getNotificationColor = (type, severity) => {
    if (severity === 'critical') return '#dc2626';
    if (severity === 'warning') return '#f59e0b';
    if (type === 'harvest') return '#34d399';
    return '#60a5fa';
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
        <Text style={styles.loadingText}>Loading notifications...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Header with Badge */}
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>
          Notifications
        </Text>
        {unreadCount > 0 && (
          <Badge style={styles.badge} size={24}>
            {unreadCount}
          </Badge>
        )}
      </View>

      {unreadCount > 0 && (
        <View style={styles.markAllContainer}>
          <Text style={styles.unreadText}>{unreadCount} unread</Text>
          <Text style={styles.markAllLink} onPress={markAllAsRead}>
            Mark all as read
          </Text>
        </View>
      )}

      {/* Notification Preferences */}
      <Card style={styles.card}>
        <Card.Title
          title="Notification Preferences"
          titleStyle={styles.cardTitle}
          left={(props) => <Icon {...props} name="cog" size={24} color="#60a5fa" />}
        />
        <Card.Content>
          <List.Item
            title="Harvest Reminders"
            description="Alert 1 day before expected harvest"
            left={(props) => <List.Icon {...props} icon="basket" color="#34d399" />}
            right={() => (
              <Switch
                value={preferences.harvestReminders}
                onValueChange={() => togglePreference('harvestReminders')}
                color="#60a5fa"
              />
            )}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
          <List.Item
            title="Anomaly Alerts"
            description="Temperature, humidity, sensor warnings"
            left={(props) => <List.Icon {...props} icon="alert-circle" color="#f59e0b" />}
            right={() => (
              <Switch
                value={preferences.anomalyAlerts}
                onValueChange={() => togglePreference('anomalyAlerts')}
                color="#60a5fa"
              />
            )}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
          <List.Item
            title="Device Status"
            description="Offline devices, connection issues"
            left={(props) => <List.Icon {...props} icon="connection" color="#64748b" />}
            right={() => (
              <Switch
                value={preferences.deviceOffline}
                onValueChange={() => togglePreference('deviceOffline')}
                color="#60a5fa"
              />
            )}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
          <List.Item
            title="Low Inventory"
            description="Alert when trays below threshold"
            left={(props) => <List.Icon {...props} icon="package-variant" color="#a78bfa" />}
            right={() => (
              <Switch
                value={preferences.lowInventory}
                onValueChange={() => togglePreference('lowInventory')}
                color="#60a5fa"
              />
            )}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
          <List.Item
            title="Daily Summary"
            description="End-of-day farm status report"
            left={(props) => <List.Icon {...props} icon="chart-box" color="#3b82f6" />}
            right={() => (
              <Switch
                value={preferences.dailySummary}
                onValueChange={() => togglePreference('dailySummary')}
                color="#60a5fa"
              />
            )}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
        </Card.Content>
      </Card>

      {/* Notification List */}
      <Card style={styles.card}>
        <Card.Title
          title="Recent Notifications"
          titleStyle={styles.cardTitle}
          left={(props) => <Icon {...props} name="bell" size={24} color="#60a5fa" />}
        />
        <Card.Content>
          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="bell-off" size={48} color="#64748b" />
              <Text style={styles.emptyText}>No notifications yet</Text>
            </View>
          ) : (
            notifications.map((notification) => (
              <View
                key={notification.id}
                style={[
                  styles.notificationItem,
                  !notification.read && styles.unreadItem,
                ]}
                onTouchEnd={() => !notification.read && markAsRead(notification.id)}
              >
                <Icon
                  name={getNotificationIcon(notification.type)}
                  size={24}
                  color={getNotificationColor(notification.type, notification.severity)}
                  style={styles.notificationIcon}
                />
                <View style={styles.notificationContent}>
                  <Text style={styles.notificationTitle}>
                    {notification.title}
                  </Text>
                  <Text style={styles.notificationMessage} numberOfLines={2}>
                    {notification.message}
                  </Text>
                  <Text style={styles.notificationTime}>
                    {formatTimestamp(notification.timestamp)}
                  </Text>
                </View>
                {!notification.read && <View style={styles.unreadDot} />}
              </View>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    marginTop: 16,
    color: '#94a3b8',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  title: {
    color: '#f8fafc',
    fontWeight: 'bold',
  },
  badge: {
    backgroundColor: '#dc2626',
  },
  markAllContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  unreadText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  markAllLink: {
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#1e293b',
    marginBottom: 16,
  },
  cardTitle: {
    color: '#f8fafc',
  },
  listTitle: {
    color: '#f8fafc',
  },
  listDescription: {
    color: '#94a3b8',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#64748b',
    marginTop: 12,
    fontSize: 16,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    borderRadius: 8,
  },
  unreadItem: {
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
  },
  notificationIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  notificationMessage: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 4,
  },
  notificationTime: {
    color: '#64748b',
    fontSize: 11,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#60a5fa',
    marginTop: 8,
    marginLeft: 8,
  },
});
