import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, TextInput, Button, Card, ActivityIndicator, Menu, Divider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCrops } from '../context/CropsContext';
import api from '../services/api';

const LOSS_REASONS = [
  { value: 'disease', label: 'Disease' },
  { value: 'pest', label: 'Pest Damage' },
  { value: 'mechanical', label: 'Mechanical Damage' },
  { value: 'nutrient', label: 'Nutrient Issue' },
  { value: 'environmental', label: 'Environmental Stress' },
  { value: 'accident', label: 'Accident/Spill' },
  { value: 'contamination', label: 'Contamination' },
  { value: 'other', label: 'Other' }
];

export default function ReportLossScreen({ route, navigation }) {
  const { trayRunId, trayData } = route.params || {};
  const { crops, isLoading: cropsLoading, error: cropsError } = useCrops();
  
  const [selectedCrop, setSelectedCrop] = useState(null);
  const [cropMenuVisible, setCropMenuVisible] = useState(false);
  const [selectedReason, setSelectedReason] = useState(null);
  const [reasonMenuVisible, setReasonMenuVisible] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-select crop if tray data includes it
  useEffect(() => {
    if (trayData?.crop_name && crops.length > 0) {
      const matchingCrop = crops.find(c => 
        c.name.toLowerCase() === trayData.crop_name.toLowerCase()
      );
      if (matchingCrop) {
        setSelectedCrop(matchingCrop);
      }
    }
  }, [trayData, crops]);

  const handleSubmit = async () => {
    // Validation
    if (!selectedCrop) {
      Alert.alert('Validation Error', 'Please select a crop');
      return;
    }

    if (!selectedReason) {
      Alert.alert('Validation Error', 'Please select a loss reason');
      return;
    }

    setIsSubmitting(true);

    try {
      const lossData = {
        crop_name: selectedCrop.name,
        crop_id: selectedCrop.id,
        loss_reason: selectedReason,
        lost_quantity: quantity ? parseInt(quantity, 10) : null,
        notes: notes.trim()
      };

      const result = await api.reportTrayLoss(trayRunId, lossData);

      Alert.alert(
        'Loss Recorded',
        'Tray has been marked as lost and removed from active inventory.',
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.navigate('Dashboard');
            }
          }
        ]
      );

    } catch (error) {
      console.error('[ReportLoss] Error submitting loss:', error);
      
      const errorMessage = error.response?.data?.error || 
                          error.message || 
                          'Failed to record loss';
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (cropsLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading crop data...</Text>
      </View>
    );
  }

  if (cropsError) {
    return (
      <View style={styles.centerContainer}>
        <Icon name="alert-circle" size={64} color="#ef4444" />
        <Text variant="headlineSmall" style={styles.errorTitle}>
          Failed to Load Crops
        </Text>
        <Text style={styles.errorText}>{cropsError}</Text>
        <Button mode="contained" onPress={() => navigation.goBack()}>
          Go Back
        </Button>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Title
          title="Report Tray Loss"
          subtitle={`Tray Run ID: ${trayRunId}`}
          left={(props) => <Icon {...props} name="alert-circle-outline" size={40} color="#f59e0b" />}
        />
        <Card.Content>
          <Text variant="bodyMedium" style={styles.instructions}>
            Record the loss of this tray to remove it from active inventory.
          </Text>

          <Divider style={styles.divider} />

          {/* Crop Selection */}
          <View style={styles.fieldContainer}>
            <Text variant="labelLarge" style={styles.label}>
              Crop *
            </Text>
            <Menu
              visible={cropMenuVisible}
              onDismiss={() => setCropMenuVisible(false)}
              anchor={
                <Button
                  mode="outlined"
                  onPress={() => setCropMenuVisible(true)}
                  icon="chevron-down"
                  contentStyle={styles.menuButton}
                  style={styles.menuButtonContainer}
                >
                  {selectedCrop ? selectedCrop.name : 'Select Crop'}
                </Button>
              }
            >
              {crops.map((crop) => (
                <Menu.Item
                  key={crop.id}
                  onPress={() => {
                    setSelectedCrop(crop);
                    setCropMenuVisible(false);
                  }}
                  title={crop.name}
                  leadingIcon={selectedCrop?.id === crop.id ? 'check' : undefined}
                />
              ))}
            </Menu>
          </View>

          {/* Loss Reason Selection */}
          <View style={styles.fieldContainer}>
            <Text variant="labelLarge" style={styles.label}>
              Loss Reason *
            </Text>
            <Menu
              visible={reasonMenuVisible}
              onDismiss={() => setReasonMenuVisible(false)}
              anchor={
                <Button
                  mode="outlined"
                  onPress={() => setReasonMenuVisible(true)}
                  icon="chevron-down"
                  contentStyle={styles.menuButton}
                  style={styles.menuButtonContainer}
                >
                  {selectedReason ? LOSS_REASONS.find(r => r.value === selectedReason)?.label : 'Select Reason'}
                </Button>
              }
            >
              {LOSS_REASONS.map((reason) => (
                <Menu.Item
                  key={reason.value}
                  onPress={() => {
                    setSelectedReason(reason.value);
                    setReasonMenuVisible(false);
                  }}
                  title={reason.label}
                  leadingIcon={selectedReason === reason.value ? 'check' : undefined}
                />
              ))}
            </Menu>
          </View>

          {/* Lost Quantity (Optional) */}
          <View style={styles.fieldContainer}>
            <Text variant="labelLarge" style={styles.label}>
              Lost Quantity (Optional)
            </Text>
            <TextInput
              mode="outlined"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
              placeholder="Number of plants/units"
              style={styles.input}
            />
          </View>

          {/* Notes */}
          <View style={styles.fieldContainer}>
            <Text variant="labelLarge" style={styles.label}>
              Notes (Optional)
            </Text>
            <TextInput
              mode="outlined"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              placeholder="Additional details about the loss..."
              style={styles.textArea}
            />
          </View>
        </Card.Content>

        <Card.Actions style={styles.actions}>
          <Button
            mode="outlined"
            onPress={() => navigation.goBack()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting || !selectedCrop || !selectedReason}
            buttonColor="#ef4444"
          >
            Record Loss
          </Button>
        </Card.Actions>
      </Card>

      <Card style={styles.warningCard}>
        <Card.Content>
          <View style={styles.warningContent}>
            <Icon name="information" size={24} color="#f59e0b" />
            <Text variant="bodySmall" style={styles.warningText}>
              This action will mark the tray as lost and remove it from active inventory. 
              It cannot be undone.
            </Text>
          </View>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    margin: 16,
    marginBottom: 8,
  },
  instructions: {
    marginBottom: 8,
    color: '#666',
  },
  divider: {
    marginVertical: 16,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 8,
    fontWeight: '600',
  },
  menuButton: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  menuButtonContainer: {
    width: '100%',
  },
  input: {
    backgroundColor: '#fff',
  },
  textArea: {
    backgroundColor: '#fff',
    minHeight: 100,
  },
  actions: {
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  warningCard: {
    margin: 16,
    marginTop: 8,
    backgroundColor: '#fffbeb',
  },
  warningContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  warningText: {
    flex: 1,
    marginLeft: 12,
    color: '#92400e',
  },
  loadingText: {
    marginTop: 16,
  },
  errorTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 16,
    color: '#666',
  },
});
