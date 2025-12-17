import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Button, List, Divider } from 'react-native-paper';
import { useAuth } from '../context/AuthContext';

export default function SettingsScreen({ navigation }) {
  const { user, farm, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    // Navigation will automatically redirect to login via AuthContext
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge" style={styles.sectionTitle}>
            Account
          </Text>
          <List.Item
            title={user?.name || 'User'}
            description={user?.email}
            left={(props) => <List.Icon {...props} icon="account" color="#60a5fa" />}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge" style={styles.sectionTitle}>
            Farm Connection
          </Text>
          <List.Item
            title={farm?.name || 'No Farm'}
            description={farm?.url}
            left={(props) => <List.Icon {...props} icon="farm" color="#34d399" />}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge" style={styles.sectionTitle}>
            App Information
          </Text>
          <List.Item
            title="Version"
            description="1.0.0"
            left={(props) => <List.Icon {...props} icon="information" />}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
          <List.Item
            title="Build"
            description="December 2025"
            left={(props) => <List.Icon {...props} icon="hammer" />}
            titleStyle={styles.listTitle}
            descriptionStyle={styles.listDescription}
          />
        </Card.Content>
      </Card>

      <Button
        mode="contained"
        onPress={handleLogout}
        style={styles.logoutButton}
        buttonColor="#dc2626"
        icon="logout"
      >
        Sign Out
      </Button>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Light Engine Mobile • Greenreach 2024
        </Text>
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
  card: {
    backgroundColor: '#1e293b',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  listTitle: {
    color: '#f8fafc',
  },
  listDescription: {
    color: '#94a3b8',
  },
  logoutButton: {
    marginTop: 8,
    marginBottom: 24,
    paddingVertical: 6,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerText: {
    color: '#64748b',
    fontSize: 12,
  },
});
