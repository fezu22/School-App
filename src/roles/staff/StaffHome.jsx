import React from 'react';
import RoleHome from '../../components/RoleHome';
import { staffModules } from './modules';

export default function StaffHome({ navigation }) {
  return (
    <RoleHome navigation={navigation} modules={staffModules} />
  );
}
