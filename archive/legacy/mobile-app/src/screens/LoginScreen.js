import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import {
  TextInput,
  Button,
  Text,
  Card,
  ActivityIndicator,
  HelperText,
} from 'react-native-paper';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [farmUrl, setFarmUrl] = useState('http://192.168.1.100:8000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleLogin = async () => {
    setError('');
    
    if (!email || !password || !farmUrl) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const result = await login(email, password, farmUrl);
      if (!result.success) {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection error. Please check farm URL.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text variant="displaySmall" style={styles.title}>
            Light Engine
          </Text>
          <Text variant="titleMedium" style={styles.subtitle}>
            Farm Inventory Management
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content>
            <TextInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              mode="outlined"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={styles.input}
            />

            <TextInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              mode="outlined"
              secureTextEntry
              autoComplete="password"
              style={styles.input}
            />

            <TextInput
              label="Farm URL"
              value={farmUrl}
              onChangeText={setFarmUrl}
              mode="outlined"
              keyboardType="url"
              autoCapitalize="none"
              placeholder="http://192.168.1.100:8000"
              style={styles.input}
            />

            <HelperText type="info" visible={true}>
              Enter your farm's local network address
            </HelperText>

            {error ? (
              <HelperText type="error" visible={true}>
                {error}
              </HelperText>
            ) : null}

            <Button
              mode="contained"
              onPress={handleLogin}
              loading={loading}
              disabled={loading}
              style={styles.button}
            >
              Sign In
            </Button>
          </Card.Content>
        </Card>

        <View style={styles.footer}>
          <Text variant="bodySmall" style={styles.footerText}>
            v1.0.0 • Greenreach 2024
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    color: '#60a5fa',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: '#94a3b8',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  input: {
    marginBottom: 12,
  },
  button: {
    marginTop: 16,
    paddingVertical: 6,
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
  },
  footerText: {
    color: '#64748b',
  },
});
