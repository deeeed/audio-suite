import 'intl-pluralrules';
import React, { useCallback, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { DefaultTheme, DarkTheme, ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UIProvider, useTheme, useThemePreferences } from '@siteed/design-system';
import type { SavedUserPreferences } from '@siteed/design-system';
import { ModelManagementProvider } from '../contexts/ModelManagement';
import { AgenticBridgeSync } from '../components/AgenticBridgeSync';
import { AgentStepHud } from '../components/AgentStepHud';
import { WebAppBanner } from '../components/WebAppBanner';
import { setLoggerConfig } from '@siteed/react-native-logger';
import '../agentic-bridge';

setLoggerConfig({ namespaces: '*', maxLogs: 500 });

const THEME_STORAGE_KEY = 'sherpa-voice-theme-preferences';

function AppContent() {
  const { darkMode } = useThemePreferences();
  const theme = useTheme();

  const baseTheme = darkMode ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseTheme,
    ...theme,
    dark: !!darkMode,
    colors: {
      ...baseTheme.colors,
      ...theme.colors,
    },
    fonts: DefaultTheme.fonts,
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={darkMode ? 'light' : 'dark'} />
      <WebAppBanner />
      <AgenticBridgeSync />
      <AgentStepHud />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="download" options={{ title: 'Download', headerBackTitle: 'Back' }} />
        <Stack.Screen name="logs" options={{ title: 'Logs', headerBackTitle: 'Back' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [preferences, setPreferences] = useState<SavedUserPreferences | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored) {
        try {
          setPreferences(JSON.parse(stored));
        } catch {}
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  const savePreferences = useCallback(async (newPreferences: SavedUserPreferences) => {
    setPreferences(newPreferences);
    await AsyncStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(newPreferences));
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <UIProvider
        preferences={preferences}
        actions={{ savePreferences }}
      >
        <ModelManagementProvider>
          <AppContent />
        </ModelManagementProvider>
      </UIProvider>
    </SafeAreaProvider>
  );
}
