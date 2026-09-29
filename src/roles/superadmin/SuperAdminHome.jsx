import React from 'react';
import RoleHome from '../../components/RoleHome';
import { superAdminModules } from './modules';

export default function SuperAdminHome({ navigation }) {
  return (
    <RoleHome
      navigation={navigation}
      modules={superAdminModules}
      subtitle="Full school control. Only Super Admin tools appear here."
    />
  );
}
