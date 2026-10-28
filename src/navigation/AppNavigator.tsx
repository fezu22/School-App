import React, {useCallback, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import AuthNavigator from './AuthNavigator';
import MobileApp from '../mobileApp/MobileApp';
import {logout} from '../mobileApp/shared/services/authService';
import SessionBootstrap from '../mobileApp/SessionBootstrap';
const AppNavigator = ({developmentPreview = false}: {developmentPreview?: boolean}) => {
  const [user, setUser] = useState<any>(null); const [restoring, setRestoring] = useState(true); const [developerPreview, setDeveloperPreview] = useState(false); const preview = (developmentPreview || developerPreview) && typeof __DEV__ !== 'undefined' && __DEV__;
  const restored = useCallback((restoredUser: any) => {setUser(restoredUser); setRestoring(false);}, []);
  const exitStaff = useCallback(() => {setUser(null); void logout();}, []);
  const staff = user && ['teacher', 'principal', 'super_admin'].includes(user.role);
  const StaffWorkspace = staff ? require('../mobileApp/app/StaffWorkspace').default : null;
  return <NavigationContainer><SessionBootstrap disabled={preview} onComplete={restored}/>{preview ? <MobileApp developmentPreview onLogout={() => {setDeveloperPreview(false); setUser(null);}} /> : restoring ? <MobileApp authLoading /> : staff ? <StaffWorkspace user={user} onExit={exitStaff} /> : user ? <MobileApp authState={{isAuthenticated: true, user}} onLogout={async () => {setUser(null); await logout();}} /> : <AuthNavigator onAuthenticated={setUser} onDeveloperPreview={() => {if (typeof __DEV__ !== 'undefined' && __DEV__) setDeveloperPreview(true);}} />}</NavigationContainer>;
};
export default AppNavigator;
