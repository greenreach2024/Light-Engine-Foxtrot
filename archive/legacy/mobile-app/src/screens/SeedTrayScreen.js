import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  ActivityIndicator,
  TextInput,
  HelperText,
  Chip,
  Divider,
} from 'react-native-paper';
import { Picker } from '@react-native-picker/picker';
import api from '../services/api';

export default function SeedTrayScreen({ route, navigation }) {
  const { qrCode } = route.params;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [trayFormats, setTrayFormats] = useState([]);
  const [selectedRecipe, setSelectedRecipe] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('');
  const [seedDate, setSeedDate] = useState(new Date().toISOString().split('T')[0]);
  const [plantCount, setPlantCount] = useState('');
  const [error, setError] = useState('');
  const [trayInfo, setTrayInfo] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setError('');
      const [recipesData, formatsData] = await Promise.all([
        api.getRecipes(),
        api.getTrayFormats(),
      ]);
      
      // Convert recipes object to array
      const recipesArray = Object.entries(recipesData).map(([id, recipe]) => ({
        id,
        ...recipe,
      }));
      
      setRecipes(recipesArray);
      setTrayFormats(formatsData);
      
      if (formatsData.length > 0) {
        setSelectedFormat(formatsData[0].trayFormatId);
      }
      
      // Try to get existing tray info
      try {
        const info = await api.getTrayInfo(qrCode);
        setTrayInfo(info);
      } catch (err) {
        // Tray not registered yet - that's okay
        console.log('Tray not yet registered');
      }
    } catch (err) {
      console.error('Load data error:', err);
      setError('Failed to load recipes and tray formats');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedRecipe) {
      setError('Please select a recipe');
      return;
    }
    
    if (!selectedFormat) {
      setError('Please select a tray format');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      let trayId = trayInfo?.trayId;
      
      // Register tray if not already registered
      if (!trayId) {
        const registerResult = await api.registerTray(qrCode, selectedFormat);
        trayId = registerResult.trayId;
      }

      // Seed the tray
      const plantSiteCount = plantCount ? parseInt(plantCount) : null;
      await api.seedTray(trayId, selectedRecipe, seedDate, plantSiteCount);

      // Success - navigate back
      navigation.goBack();
      navigation.navigate('Dashboard');
    } catch (err) {
      console.error('Seed tray error:', err);
      setError(err.response?.data?.detail || 'Failed to seed tray');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const selectedRecipeObj = recipes.find((r) => r.id === selectedRecipe);
  const selectedFormatObj = trayFormats.find((f) => f.trayFormatId === selectedFormat);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={styles.label}>
              Tray QR Code
            </Text>
            <Chip icon="qrcode" style={styles.chip}>
              {qrCode}
            </Chip>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={styles.label}>
              Select Recipe
            </Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={selectedRecipe}
                onValueChange={setSelectedRecipe}
                style={styles.picker}
              >
                <Picker.Item label="Choose a recipe..." value="" />
                {recipes.map((recipe) => (
                  <Picker.Item
                    key={recipe.id}
                    label={recipe.name}
                    value={recipe.id}
                  />
                ))}
              </Picker>
            </View>
            
            {selectedRecipeObj && (
              <View style={styles.recipeInfo}>
                <Text style={styles.recipeDetail}>
                  {selectedRecipeObj.variety || selectedRecipeObj.crop}
                </Text>
                <Text style={styles.recipeDetail}>
                  📅 {selectedRecipeObj.daysToHarvest} days to harvest
                </Text>
              </View>
            )}
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={styles.label}>
              Tray Format
            </Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={selectedFormat}
                onValueChange={setSelectedFormat}
                style={styles.picker}
              >
                {trayFormats.map((format) => (
                  <Picker.Item
                    key={format.trayFormatId}
                    label={`${format.name} (${format.plantSiteCount} cells)`}
                    value={format.trayFormatId}
                  />
                ))}
              </Picker>
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content>
            <TextInput
              label="Seed Date"
              value={seedDate}
              onChangeText={setSeedDate}
              mode="outlined"
              style={styles.input}
              placeholder="YYYY-MM-DD"
            />

            <TextInput
              label="Plant Count (Optional)"
              value={plantCount}
              onChangeText={setPlantCount}
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
              placeholder={selectedFormatObj ? `Max: ${selectedFormatObj.plantSiteCount}` : ''}
            />
            
            <HelperText type="info">
              Leave blank to use full tray capacity
            </HelperText>
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
          disabled={submitting || !selectedRecipe || !selectedFormat}
          style={styles.submitButton}
          icon="seed"
        >
          Seed Tray
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
  },
  pickerContainer: {
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden',
  },
  picker: {
    color: '#f8fafc',
  },
  recipeInfo: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#334155',
    borderRadius: 4,
  },
  recipeDetail: {
    color: '#94a3b8',
    marginVertical: 4,
  },
  input: {
    marginBottom: 12,
  },
  error: {
    marginBottom: 12,
  },
  submitButton: {
    paddingVertical: 6,
    marginBottom: 24,
  },
});
