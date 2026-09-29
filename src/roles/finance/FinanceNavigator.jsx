import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screenOptions } from '../../navigation/screenOptions';
import PasswordScreen from '../../screens/PasswordScreen';
import FinanceHome from './FinanceHome';
import FinanceInvoicesScreen from './screens/FinanceInvoicesScreen';
import FinanceInvoiceDetailScreen from './screens/FinanceInvoiceDetailScreen';
import FinanceStudentsScreen from './screens/FinanceStudentsScreen';
import FinanceNoticesScreen from './screens/FinanceNoticesScreen';

const Stack = createNativeStackNavigator();
export default function FinanceNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Home" component={FinanceHome} options={{ title: 'Finance' }} />
      <Stack.Screen name="Invoices" component={FinanceInvoicesScreen} options={{ title: 'Fees & receipts' }} />
      <Stack.Screen name="InvoiceDetail" component={FinanceInvoiceDetailScreen} options={{ title: 'Invoice & receipts' }} />
      <Stack.Screen name="Students" component={FinanceStudentsScreen} />
      <Stack.Screen name="Notices" component={FinanceNoticesScreen} />
      <Stack.Screen name="Password" component={PasswordScreen} />
    </Stack.Navigator>
  );
}
