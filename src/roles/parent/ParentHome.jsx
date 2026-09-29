import React from 'react';
import RoleHome from '../../components/RoleHome';
import { parentModules } from './modules';

export default function ParentHome({ navigation }) {
  return (
    <RoleHome
      navigation={navigation}
      modules={parentModules}
      subtitle="Follow your children's school progress."
      statLabels={["Children's classes", 'Linked children']}
    />
  );
}
