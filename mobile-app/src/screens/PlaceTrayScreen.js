import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Card, Button, ActivityIndicator, TextInput, HelperText, Chip } from 'react-native-paper';
import api from '../services/api';

export default function PlaceTrayScreen({ route, navigation }) {
  const { qrCode } = route.params;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [trayInfo, setTrayInfo] = useState(null);
  const [locationQR, setLocationQR] = useState('');
  const [locationInfo, setLocationInfo] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [scanningLocation, setScanningLocation] = useState(false);

  useEffect(() => {
    loadTrayInfo();
  }, []);

  const loadTrayInfo = async () => {
    try {
      setError('');
      const info = await api.getTrayInfo(qrCode);
      setTrayInfo(info);
      
      if (!info.activeRun) {
        setError('This tray has not been seeded yet');
      }
    } catch (err) {
      console.error('Load tray error:', err);
      setError('Failed to load tray information');
    } finally {
      setLoading(false);
    }
  };

  const handleLocationScan = () => {
    // Navigate to scanner for location QR
    navigation.navigate('Scanner');
  };

  const handleLocationLookup = async () => {
    if (!locationQR) {
      setError('Please enter a location QR code');
      return;
    }

    try {
      setError('');
      const locInfo = await api.getLocationByQR(locationQR);
      setLocationInfo(locInfo);
    } catch (err) {
      console.error('Location lookup error:', err);
      setError('Location not found. Please register it first.');
    }
  };

  const handleSubmit = async () => {
    if (!locationInfo) {
      setError('Please scan or enter a location QR code');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await api.placeTray(
        trayInfo.activeRun.trayRunId,
        locationInfo.locationId,
        new Date().toISOString(),
        note || null
      );

      // Success
      navigation.goBack();
      navigation.navigate('Dashboard');
    } catch (err) {
      console.error('Place tray error:', err);
      setError(err.response?.data?.detail || 'Failed to place tray');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
        <Text style={styles.loadingText}>Loading tray info...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={styles.label}>
              Tray Information
            </Text>
            <Chip icon="qrcode" style={styles.chip}>
              {qrCode}
            </Chip>
            {trayInfo?.activeRun && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Recipe: {trayInfo.activeRun.recipeName || 'Unknown'}
                </Text>
                <Text style={styles.infoText}>
                  📅 Seeded: {trayInfo.activeRun.seedDate}
                </Text>
                <Text style={styles.infoText}>
                  Expected Harvest: {trayInfo.activeRun.expectedHarvestDate}
                </Text>
              </View>
            )}
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={styles.label}>
              Location
            </Text>
            
            <View style={styles.locationActions}>
              <Button
                mode="outlined"
                icon="qrcode-scan"
                onPress={handleLocationScan}
                style={styles.scanButton}
              >
                Scan Location
              </Button>
            </View>

            <Text style={styles.orText}>OR</Text>

            <View style={styles.manualEntry}>
              <TextInput
                label="Location QR Code"
                value={locationQR}
                onChangeText={setLocationQR}
                mode="outlined"
                style={styles.input}
                placeholder="Enter location code manually"
              />
              <Button
                mode="contained-tonal"
                onPress={handleLocationLookup}
                disabled={!locationQR}
              >
                Lookup
              </Button>
            </View>

            {locationInfo && (
              <View style={styles.locationInfo}>
                <Text style={styles.successText}>✓ Location Found</Text>
                <Text style={styles.locationDetail}>
                  📍 {locationInfo.name || locationInfo.qrCodeValue}
                </Text>
                <Text style={styles.locationDetail}>
                  Group: {locationInfo.groupName || 'N/A'}
                </Text>
              </View>
            )}
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content>
            <TextInput
              label="Notes (Optional)"
              value={note}
              onChangeText={setNote}
              mode="outlined"
              multiline
              numberOfLines={3}
              style={styles.input}
              placeholder="Add placement notes..."
            />
          </Card.Content>
        </Card>

        {error ? (
          <HelperText type="error" style={styles.error}>
            {error}
          </HelperText>
        ) : null}

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || !locationInfo || !trayInfo?.activeRun}
          style={styles.submitButton}
          icon="map-marker-check"
        >
          Place Tray
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
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
  scrollContent: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    marginBottom: 16,
  },
  label: {
    color: '#f8fafc',
    marginBottom: 12,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#334155',
    marginBottom: 12,
  },
  infoBox: {
    padding: 12,
    backgroundColor: '#334155',
    borderRadius: 4,
  },
  infoText: {
    color: '#94a3b8',
    marginVertical: 4,
  },
  locationActions: {
    marginBottom: 16,
  },
  scanButton: {
    borderColor: '#60a5fa',
  },
  orText: {
    textAlign: 'center',
    color: '#64748b',
    marginVertical: 12,
  },
  manualEntry: {
    flexDirection: 'column',
    gap: 8,
  },
  input: {
    marginBottom: 8,
  },
  locationInfo: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#065f46',
    borderRadius: 4,
  },
  successText: {
    color: '#34d399',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  locationDetail: {
    color: '#d1fae5',
    marginVertical: 2,
  },
  error: {
    marginBottom: 12,
  },
  submitButton: {
    paddingVertical: 6,
    marginBottom: 24,
  },
});
