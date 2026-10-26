import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import LoginScreen from '../screens/auth/LoginScreen';
export type AuthStackParamList = {Login: undefined};
const Stack = createNativeStackNavigator<AuthStackParamList>();
const AuthNavigator = ({onAuthenticated, onDeveloperPreview}: {onAuthenticated: (user: any) => void; onDeveloperPreview?: () => void}) => <Stack.Navigator><Stack.Screen name="Login" options={{headerShown: false}}>{() => <LoginScreen onAuthenticated={onAuthenticated} onDeveloperPreview={onDeveloperPreview} />}</Stack.Screen></Stack.Navigator>;
export default AuthNavigator;
