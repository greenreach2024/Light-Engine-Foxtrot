import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Card, Button, ActivityIndicator, TextInput, HelperText, Chip } from 'react-native-paper';
import api from '../services/api';

export default function HarvestTrayScreen({ route, navigation }) {
  const { qrCode } = route.params;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [trayInfo, setTrayInfo] = useState(null);
  const [harvestCount, setHarvestCount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

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
      } else if (info.activeRun.harvestedAt) {
        setError('This tray has already been harvested');
      }
    } catch (err) {
      console.error('Load tray error:', err);
      setError('Failed to load tray information');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      const actualCount = harvestCount ? parseInt(harvestCount) : null;
      
      await api.harvestTray(
        trayInfo.activeRun.trayRunId,
        new Date().toISOString(),
        actualCount,
        note || null
      );

      // Success
      navigation.goBack();
      navigation.navigate('Dashboard');
    } catch (err) {
      console.error('Harvest tray error:', err);
      setError(err.response?.data?.detail || 'Failed to record harvest');
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

  const daysGrowing = trayInfo?.activeRun?.seedDate
    ? Math.floor(
        (new Date() - new Date(trayInfo.activeRun.seedDate)) / (1000 * 60 * 60 * 24)
      )
    : 0;

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
                  Days Growing: {daysGrowing}
                </Text>
                <Text style={styles.infoText}>
                  Expected Harvest: {trayInfo.activeRun.expectedHarvestDate}
                </Text>
                <Text style={styles.infoText}>
                  🌿 Expected Count: {trayInfo.activeRun.plantedSiteCount || 'Full tray'}
                </Text>
              </View>
            )}
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={styles.label}>
              Harvest Details
            </Text>

            <TextInput
              label="Actual Harvest Count"
              value={harvestCount}
              onChangeText={setHarvestCount}
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
              placeholder="Number of plants harvested"
            />

            <HelperText type="info">
              Enter the actual number of plants you harvested
            </HelperText>

            <TextInput
              label="Harvest Notes (Optional)"
              value={note}
              onChangeText={setNote}
              mode="outlined"
              multiline
              numberOfLines={4}
              style={styles.input}
              placeholder="Quality, issues, observations..."
            />
          </Card.Content>
        </Card>

        {trayInfo?.activeRun && !trayInfo.activeRun.harvestedAt ? (
          <Card style={styles.readyCard}>
            <Card.Content>
              <Text style={styles.readyText}> Ready to Harvest</Text>
              <Text style={styles.readySubtext}>
                This tray is {daysGrowing} days old
              </Text>
            </Card.Content>
          </Card>
        ) : null}

        {error ? (
          <HelperText type="error" style={styles.error}>
            {error}
          </HelperText>
        ) : null}

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || !trayInfo?.activeRun || trayInfo?.activeRun?.harvestedAt}
          style={styles.submitButton}
          icon="basket-check"
        >
          Record Harvest
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
  input: {
    marginBottom: 12,
  },
  readyCard: {
    backgroundColor: '#065f46',
    marginBottom: 16,
  },
  readyText: {
    color: '#34d399',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  readySubtext: {
    color: '#d1fae5',
  },
  error: {
    marginBottom: 12,
  },
  submitButton: {
    paddingVertical: 6,
    marginBottom: 24,
  },
});
