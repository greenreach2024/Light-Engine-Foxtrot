import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { Camera } from 'expo-camera';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { Button, Text, Card, Portal, Dialog } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export default function ScannerScreen({ navigation }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [scanData, setScanData] = useState(null);
  const [dialogVisible, setDialogVisible] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = ({ type, data }) => {
    if (scanned) return;
    
    setScanned(true);
    setScanData(data);
    setDialogVisible(true);
  };

  const handleAction = (action) => {
    setDialogVisible(false);
    
    if (action === 'seed') {
      navigation.navigate('SeedTray', { qrCode: scanData });
    } else if (action === 'place') {
      navigation.navigate('PlaceTray', { qrCode: scanData });
    } else if (action === 'harvest') {
      navigation.navigate('HarvestTray', { qrCode: scanData });
    } else if (action === 'loss') {
      navigation.navigate('ReportLoss', { 
        qrCode: scanData,
        trayRunId: scanData // In production, you'd parse/lookup the actual tray run ID
      });
    }
    
    // Reset scanner after navigation
    setTimeout(() => {
      setScanned(false);
      setScanData(null);
    }, 500);
  };

  const handleCancel = () => {
    setDialogVisible(false);
    setScanned(false);
    setScanData(null);
  };

  if (hasPermission === null) {
    return (
      <View style={styles.centerContainer}>
        <Text>Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.centerContainer}>
        <Icon name="camera-off" size={64} color="#ef4444" />
        <Text variant="headlineSmall" style={styles.errorTitle}>
          No Camera Access
        </Text>
        <Text style={styles.errorText}>
          Please enable camera permissions in your device settings
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={styles.camera}
        type={Camera.Constants.Type.back}
        onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
        barCodeScannerSettings={{
          barCodeTypes: [BarCodeScanner.Constants.BarCodeType.qr],
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.topOverlay} />
          <View style={styles.middleRow}>
            <View style={styles.sideOverlay} />
            <View style={styles.scanWindow}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <View style={styles.sideOverlay} />
          </View>
          <View style={styles.bottomOverlay}>
            <Text variant="titleMedium" style={styles.instructionText}>
              Align QR code within frame
            </Text>
            <Text variant="bodyMedium" style={styles.hintText}>
              Scans trays and location codes
            </Text>
          </View>
        </View>
      </Camera>

      <Portal>
        <Dialog visible={dialogVisible} onDismiss={handleCancel} style={styles.dialog}>
          <Dialog.Title>QR Code Scanned</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyLarge" style={styles.dialogCode}>
              {scanData}
            </Text>
            <Text variant="bodyMedium" style={styles.dialogText}>
              What would you like to do?
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            <Button onPress={handleCancel}>Cancel</Button>
            <Button icon="seed" onPress={() => handleAction('seed')}>
              Seed
            </Button>
            <Button icon="map-marker" onPress={() => handleAction('place')}>
              Place
            </Button>
            <Button icon="basket" onPress={() => handleAction('harvest')}>
              Harvest
            </Button>
            <Button 
              icon="alert-circle" 
              onPress={() => handleAction('loss')}
              textColor="#ef4444"
            >
              Report Loss
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 20,
  },
  errorTitle: {
    color: '#f8fafc',
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    color: '#94a3b8',
    textAlign: 'center',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  topOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  middleRow: {
    flexDirection: 'row',
    height: 300,
  },
  sideOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scanWindow: {
    width: 300,
    height: 300,
    borderWidth: 2,
    borderColor: '#60a5fa',
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#60a5fa',
  },
  topLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  bottomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  instructionText: {
    color: '#f8fafc',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  hintText: {
    color: '#94a3b8',
  },
  dialog: {
    backgroundColor: '#1e293b',
  },
  dialogCode: {
    color: '#60a5fa',
    fontFamily: 'monospace',
    marginBottom: 16,
    textAlign: 'center',
  },
  dialogText: {
    color: '#94a3b8',
  },
  dialogActions: {
    flexWrap: 'wrap',
  },
});
