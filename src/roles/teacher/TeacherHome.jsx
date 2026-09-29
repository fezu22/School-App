import React from 'react';
import RoleHome from '../../components/RoleHome';
import { teacherModules } from './modules';

export default function TeacherHome({ navigation }) {
  return (
    <RoleHome
      navigation={navigation}
      modules={teacherModules}
      subtitle="Your classes and teaching tools."
    />
  );
}
