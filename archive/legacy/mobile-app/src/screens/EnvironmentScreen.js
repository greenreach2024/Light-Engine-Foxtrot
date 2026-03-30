import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Dimensions } from 'react-native';
import { Text, Card, Chip, ActivityIndicator, Button, SegmentedButtons } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LineChart } from 'react-native-chart-kit';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function EnvironmentScreen({ navigation }) {
  const { farm } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [envData, setEnvData] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState('all');
  const [timeRange, setTimeRange] = useState('1h');
  const [error, setError] = useState('');

  useEffect(() => {
    loadEnvironmentData();
  }, [selectedRoom, timeRange]);

  const loadEnvironmentData = async () => {
    try {
      setError('');
      const [envResponse, anomalyResponse] = await Promise.all([
        api.getEnvironmentData(selectedRoom, timeRange),
        api.getAnomalies(),
      ]);
      setEnvData(envResponse);
      setAnomalies(anomalyResponse.anomalies || []);
    } catch (err) {
      console.error('Environment load error:', err);
      setError('Failed to load environmental data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadEnvironmentData();
  };

  const getSeverityColor = (severity) => {
    if (severity >= 0.8) return '#dc2626'; // critical
    if (severity >= 0.5) return '#f59e0b'; // warning
    return '#3b82f6'; // info
  };

  const getSeverityLabel = (severity) => {
    if (severity >= 0.8) return 'CRITICAL';
    if (severity >= 0.5) return 'WARNING';
    return 'INFO';
  };

  const getMetricIcon = (metric) => {
    const icons = {
      tempC: 'thermometer',
      rh: 'water-percent',
      vpd: 'cloud',
      co2: 'molecule-co2',
      ppfd: 'white-balance-sunny',
    };
    return icons[metric] || 'chart-line';
  };

  const formatValue = (metric, value) => {
    if (value === null || value === undefined) return 'N/A';
    switch (metric) {
      case 'tempC':
        return `${value.toFixed(1)}°C`;
      case 'rh':
        return `${value.toFixed(0)}%`;
      case 'vpd':
        return `${value.toFixed(2)} kPa`;
      case 'co2':
        return `${value.toFixed(0)} ppm`;
      case 'ppfd':
        return `${value.toFixed(0)} μmol/m²/s`;
      default:
        return value.toFixed(1);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
        <Text style={styles.loadingText}>Loading environment data...</Text>
      </View>
    );
  }

  const rooms = envData?.rooms || {};
  const roomList = Object.keys(rooms);
  const currentRoom = selectedRoom === 'all' ? rooms[roomList[0]] : rooms[selectedRoom];
  const metrics = currentRoom?.sensors || {};

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Room Selector */}
      {roomList.length > 1 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Select Room
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.roomChips}>
                <Chip
                  selected={selectedRoom === 'all'}
                  onPress={() => setSelectedRoom('all')}
                  style={styles.roomChip}
                >
                  All Rooms
                </Chip>
                {roomList.map((roomId) => (
                  <Chip
                    key={roomId}
                    selected={selectedRoom === roomId}
                    onPress={() => setSelectedRoom(roomId)}
                    style={styles.roomChip}
                  >
                    {rooms[roomId].name || roomId}
                  </Chip>
                ))}
              </View>
            </ScrollView>
          </Card.Content>
        </Card>
      )}

      {/* Anomaly Alerts */}
      {anomalies.length > 0 && (
        <Card style={styles.alertCard}>
          <Card.Title
            title={`${anomalies.length} Active Alert${anomalies.length > 1 ? 's' : ''}`}
            titleStyle={styles.alertTitle}
            left={(props) => <Icon {...props} name="alert" size={24} color="#ef4444" />}
          />
          <Card.Content>
            {anomalies.slice(0, 3).map((anomaly, index) => (
              <View key={index} style={styles.anomalyRow}>
                <Chip
                  icon="alert-circle"
                  style={[
                    styles.severityChip,
                    { backgroundColor: getSeverityColor(anomaly.severity) },
                  ]}
                  textStyle={{ color: '#fff', fontSize: 10 }}
                >
                  {getSeverityLabel(anomaly.severity)}
                </Chip>
                <Text style={styles.anomalyText} numberOfLines={2}>
                  {anomaly.message || `${anomaly.sensor} anomaly in ${anomaly.zoneId}`}
                </Text>
              </View>
            ))}
            {anomalies.length > 3 && (
              <Button mode="text" onPress={() => {}} style={styles.viewAllButton}>
                View All {anomalies.length} Alerts
              </Button>
            )}
          </Card.Content>
        </Card>
      )}

      {/* Current Conditions */}
      <Card style={styles.card}>
        <Card.Title
          title="Current Conditions"
          titleStyle={styles.cardTitle}
          left={(props) => <Icon {...props} name="gauge" size={24} color="#60a5fa" />}
        />
        <Card.Content>
          <View style={styles.metricsGrid}>
            {Object.entries(metrics).map(([metric, data]) => (
              <View key={metric} style={styles.metricCard}>
                <Icon
                  name={getMetricIcon(metric)}
                  size={28}
                  color="#60a5fa"
                  style={styles.metricIcon}
                />
                <Text style={styles.metricValue}>
                  {formatValue(metric, data.current)}
                </Text>
                <Text style={styles.metricLabel}>
                  {metric.toUpperCase()}
                </Text>
                {data.liveSources !== undefined && (
                  <Text style={styles.metricSource}>
                    {data.liveSources}/{data.totalSources} sensors
                  </Text>
                )}
              </View>
            ))}
          </View>
        </Card.Content>
      </Card>

      {/* Historical Trend */}
      {currentRoom?.history && currentRoom.history.length > 1 && (
        <Card style={styles.card}>
          <Card.Title
            title="Temperature Trend"
            titleStyle={styles.cardTitle}
            left={(props) => <Icon {...props} name="chart-line" size={24} color="#34d399" />}
          />
          <Card.Content>
            <SegmentedButtons
              value={timeRange}
              onValueChange={setTimeRange}
              buttons={[
                { value: '1h', label: '1H' },
                { value: '6h', label: '6H' },
                { value: '24h', label: '24H' },
              ]}
              style={styles.timeSelector}
            />
            <LineChart
              data={{
                labels: currentRoom.history.slice(-10).map((h) =>
                  new Date(h.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                ),
                datasets: [
                  {
                    data: currentRoom.history.slice(-10).map((h) => h.tempC || 0),
                    color: () => '#60a5fa',
                  },
                ],
              }}
              width={Dimensions.get('window').width - 64}
              height={220}
              chartConfig={{
                backgroundColor: '#1e293b',
                backgroundGradientFrom: '#1e293b',
                backgroundGradientTo: '#334155',
                decimalPlaces: 1,
                color: (opacity = 1) => `rgba(96, 165, 250, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
                style: {
                  borderRadius: 8,
                },
                propsForDots: {
                  r: '4',
                  strokeWidth: '2',
                  stroke: '#60a5fa',
                },
              }}
              bezier
              style={styles.chart}
            />
          </Card.Content>
        </Card>
      )}

      {/* Targets & Setpoints */}
      {currentRoom?.targets && (
        <Card style={styles.card}>
          <Card.Title
            title="Target Setpoints"
            titleStyle={styles.cardTitle}
            left={(props) => <Icon {...props} name="target" size={24} color="#a78bfa" />}
          />
          <Card.Content>
            {Object.entries(currentRoom.targets).map(([metric, target]) => (
              <View key={metric} style={styles.targetRow}>
                <Text style={styles.targetLabel}>{metric.toUpperCase()}</Text>
                <Text style={styles.targetValue}>
                  {formatValue(metric, target)}
                </Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {error ? (
        <Card style={styles.errorCard}>
          <Card.Content>
            <Text style={styles.errorText}>{error}</Text>
          </Card.Content>
        </Card>
      ) : null}
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
  card: {
    backgroundColor: '#1e293b',
    marginBottom: 16,
  },
  alertCard: {
    backgroundColor: '#7f1d1d',
    marginBottom: 16,
  },
  cardTitle: {
    color: '#f8fafc',
  },
  alertTitle: {
    color: '#fecaca',
  },
  sectionTitle: {
    color: '#f8fafc',
    marginBottom: 12,
  },
  roomChips: {
    flexDirection: 'row',
    gap: 8,
  },
  roomChip: {
    marginRight: 8,
  },
  anomalyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    gap: 8,
  },
  severityChip: {
    height: 24,
  },
  anomalyText: {
    flex: 1,
    color: '#fecaca',
    fontSize: 13,
  },
  viewAllButton: {
    marginTop: 8,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#334155',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  metricIcon: {
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 4,
  },
  metricLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
  },
  metricSource: {
    fontSize: 10,
    color: '#64748b',
  },
  timeSelector: {
    marginBottom: 16,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 8,
  },
  targetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  targetLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  targetValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: 'bold',
  },
  errorCard: {
    backgroundColor: '#991b1b',
    marginBottom: 16,
  },
  errorText: {
    color: '#fecaca',
  },
});
