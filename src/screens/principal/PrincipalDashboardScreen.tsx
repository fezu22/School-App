import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

const PrincipalDashboardScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Principal Dashboard</Text>
      <Text>School Management System</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 10,
  },
});

export default PrincipalDashboardScreen;