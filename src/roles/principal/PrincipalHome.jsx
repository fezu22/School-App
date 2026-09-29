import React from 'react';
import RoleHome from '../../components/RoleHome';
import { principalModules } from './modules';

export default function PrincipalHome({ navigation }) {
  return (
    <RoleHome
      navigation={navigation}
      modules={principalModules}
      subtitle="School leadership workspace. Manage academics and operations."
    />
  );
}
