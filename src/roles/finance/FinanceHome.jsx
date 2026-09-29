import React from 'react';
import RoleHome from '../../components/RoleHome';
import { financeModules } from './modules';

export default function FinanceHome({ navigation }) {
  return (
    <RoleHome
      navigation={navigation}
      modules={financeModules}
      subtitle="Invoices, payments and receipts."
      statLabels={['Branch classes', 'Branch students']}
    />
  );
}
