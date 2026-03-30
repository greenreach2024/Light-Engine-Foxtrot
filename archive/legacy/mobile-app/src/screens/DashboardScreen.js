import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Text, Card, ActivityIndicator, Button, Chip } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function DashboardScreen({ navigation }) {
  const { user, farm } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inventory, setInventory] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setError('');
      const [inventoryData, forecastData] = await Promise.all([
        api.getCurrentInventory(user.farmId),
        api.getHarvestForecast(user.farmId),
      ]);
      setInventory(inventoryData);
      setForecast(forecastData);
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  const totalTrays = inventory?.activeTrays || 0;
  const totalPlants = inventory?.totalPlants || 0;
  const forecastBuckets = forecast?.buckets || [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.greeting}>
          Welcome, {user.name}
        </Text>
        <Chip icon="home" style={styles.farmChip}>
          {farm.name}
        </Chip>
      </View>

      {error ? (
        <Card style={styles.errorCard}>
          <Card.Content>
            <Text style={styles.errorText}>{error}</Text>
            <Button mode="outlined" onPress={loadDashboardData} style={styles.retryButton}>
              Retry
            </Button>
          </Card.Content>
        </Card>
      ) : null}

      <View style={styles.statsGrid}>
        <Card style={styles.statCard}>
          <Card.Content style={styles.statContent}>
            <Icon name="tray-full" size={32} color="#60a5fa" />
            <Text variant="headlineMedium" style={styles.statValue}>
              {totalTrays}
            </Text>
            <Text variant="bodyMedium" style={styles.statLabel}>
              Active Trays
            </Text>
          </Card.Content>
        </Card>

        <Card style={styles.statCard}>
          <Card.Content style={styles.statContent}>
            <Icon name="sprout" size={32} color="#34d399" />
            <Text variant="headlineMedium" style={styles.statValue}>
              {totalPlants}
            </Text>
            <Text variant="bodyMedium" style={styles.statLabel}>
              Total Plants
            </Text>
          </Card.Content>
        </Card>
      </View>

      <Card style={styles.forecastCard}>
        <Card.Title
          title="Harvest Forecast"
          titleStyle={styles.cardTitle}
          left={(props) => <Icon {...props} name="calendar-clock" size={24} color="#60a5fa" />}
        />
        <Card.Content>
          {forecastBuckets.map((bucket, index) => (
            <View key={index} style={styles.bucketRow}>
              <Text style={styles.bucketLabel}>{bucket.label}</Text>
              <View style={styles.bucketBar}>
                <View
                  style={[
                    styles.bucketFill,
                    { width: `${Math.min((bucket.count / totalTrays) * 100, 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.bucketCount}>{bucket.count}</Text>
            </View>
          ))}
        </Card.Content>
      </Card>

      <View style={styles.actionButtons}>
        <Button
          mode="contained"
          icon="qrcode-scan"
          onPress={() => navigation.navigate('Scanner')}
          style={styles.actionButton}
        >
          Scan QR Code
        </Button>
      </View>
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
    marginBottom: 24,
  },
  greeting: {
    color: '#f8fafc',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  farmChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e293b',
  },
  errorCard: {
    backgroundColor: '#991b1b',
    marginBottom: 16,
  },
  errorText: {
    color: '#fecaca',
    marginBottom: 8,
  },
  retryButton: {
    borderColor: '#fecaca',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: '#1e293b',
  },
  statContent: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  statValue: {
    color: '#f8fafc',
    fontWeight: 'bold',
    marginTop: 8,
  },
  statLabel: {
    color: '#94a3b8',
    marginTop: 4,
  },
  forecastCard: {
    backgroundColor: '#1e293b',
    marginBottom: 16,
  },
  cardTitle: {
    color: '#f8fafc',
  },
  bucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  bucketLabel: {
    width: 80,
    color: '#94a3b8',
    fontSize: 14,
  },
  bucketBar: {
    flex: 1,
    height: 24,
    backgroundColor: '#334155',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  bucketFill: {
    height: '100%',
    backgroundColor: '#34d399',
    borderRadius: 4,
  },
  bucketCount: {
    width: 40,
    textAlign: 'right',
    color: '#f8fafc',
    fontWeight: 'bold',
  },
  actionButtons: {
    marginTop: 8,
  },
  actionButton: {
    paddingVertical: 6,
  },
});
