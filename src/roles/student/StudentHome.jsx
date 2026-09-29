import React from 'react';
import RoleHome from '../../components/RoleHome';
import { studentModules } from './modules';

export default function StudentHome({ navigation }) {
  return (
    <RoleHome
      navigation={navigation}
      modules={studentModules}
      subtitle="Your classes, homework and fees."
      statLabels={['My classes', 'My profile']}
    />
  );
}
