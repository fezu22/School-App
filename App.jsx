import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { ParentChildProvider } from './src/auth/ParentChildContext';
import RootNavigator from './src/navigation/RootNavigator';
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#F3F6FB" />
      <AuthProvider>
        <ParentChildProvider>
          <RootNavigator />
        </ParentChildProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
