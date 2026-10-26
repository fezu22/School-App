import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import PrincipalDashboardScreen from '../screens/principal/PrincipalDashboardScreen';

export type PrincipalStackParamList = {
  PrincipalDashboard: undefined;
};

const Stack = createNativeStackNavigator<PrincipalStackParamList>();

const PrincipalNavigator = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="PrincipalDashboard"
        component={PrincipalDashboardScreen}
        options={{
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
};

export default PrincipalNavigator;