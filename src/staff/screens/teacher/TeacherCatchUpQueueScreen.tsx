import React,{useCallback}from'react';import{Text}from'react-native';import type{NativeStackScreenProps}from'@react-navigation/native-stack';
import type{TeacherStackParamList}from'../../navigation/TeacherNavigator';import{Button,Card,DashboardShell,ScreenHeading,StatusBadge}from'../../components/hiraDashboard';
import{useAuth}from'../../context/AuthContext';import{catchUpService}from'../../services/teacher/catchUpService';import{useTeacherResource}from'./useTeacherResource';import{LoadState,styles}from'./teacherUi';
export default function TeacherCatchUpQueueScreen({navigation}:NativeStackScreenProps<TeacherStackParamList,'TeacherCatchUpQueue'>){const{accessToken}=useAuth();
 const load=useCallback(()=>accessToken?catchUpService.list(accessToken):Promise.reject(new Error('Authentication required')),[accessToken]);const resource=useTeacherResource(load);
 return <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh}><ScreenHeading title="Catch-up" subtitle="Absence recovery based on delivered learning evidence"/><LoadState {...resource} retry={resource.refresh} label="Checking eligible absences..."/>
 {resource.data?.items.length===0?<Text style={styles.body}>No catch-up work requires attention.</Text>:null}{resource.data?.items.map(item=><Card key={item.catchUpId}><StatusBadge status={item.status==='completed'?'paid':'pending'} label={item.status.replaceAll('_',' ')}/>
 <Text style={styles.body}>{item.student.fullName} · {item.academic.subjectName}</Text><Text style={styles.muted}>{item.academic.className} / {item.academic.sectionName} · missed {item.absence.occurrenceDate}</Text>
 <Text style={styles.muted}>{item.lesson?`${item.lesson.topicIds.length} delivered topic(s)`:'Waiting for delivery evidence'} · Due {item.dueAt}</Text>
 <Button title={`Open Catch-up ${item.student.fullName}`} variant="secondary" onPress={()=>navigation.navigate('TeacherCatchUp',{catchUpId:item.catchUpId})}/></Card>)}</DashboardShell>}
