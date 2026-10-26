import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {authRequest} from '../../shared/services/authRequest';
import {theme as t} from '../../theme/hiraTheme';

export default function ExamPapersPage({user, onBack}) {
  const [tab, setTab] = useState('Papers');
  const [papers, setPapers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [catalog, setCatalog] = useState({branches: [], classes: [], sections: [], subjects: []});
  const [form, setForm] = useState({title: '', instructions: '', durationMinutes: '60', totalMarks: '10', branchId: '', classId: '', sectionId: '', subjectId: '', templateId: ''});
  const [template, setTemplate] = useState({name: '', header: '', footer: '', pageSize: 'A4', margin: '42'});
  const [questions, setQuestions] = useState([{text: '', marks: '10'}]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPaper, setSelectedPaper] = useState(null);
  useEffect(() => {const listener = BackHandler.addEventListener('hardwareBackPress', () => {onBack(); return true;}); return () => listener.remove();}, [onBack]);
  async function refresh() {
    setLoading(true); setError('');
    try {
      const [rows, designs, options] = await Promise.all(['/exam-papers', '/exam-papers/templates', '/exam-papers/catalog'].map(path => authRequest(path)));
      setPapers(rows); setTemplates(designs); setCatalog(options);
    } catch (e) {setError(e.message);}
    finally {setLoading(false);}
  }
  useEffect(() => {refresh();}, []);
  async function save() {
    setBusy(true); setError('');
    try {
      const isTemplate = tab === 'Templates';
      const body = isTemplate ? template : {...form, questions};
      const saved = await authRequest(isTemplate ? '/exam-papers/templates' : '/exam-papers', {method: 'POST', body: JSON.stringify(body)});
      if (!isTemplate) {setSelectedPaper(saved); setTab('Papers');}
      await refresh();
      Alert.alert(isTemplate ? 'Template saved' : 'Draft saved', 'The school API confirmed the saved record.');
    } catch (e) {setError(e.message);} finally {setBusy(false);}
  }
  async function exportPdf(paper) {
    setBusy(true); setError('');
    try {
      const file = await authRequest(`/exam-papers/${encodeURIComponent(paper.id)}/pdf`);
      const Share = require('react-native-share').default;
      await Share.open({url: `data:application/pdf;base64,${file.base64}`, type: 'application/pdf', filename: file.filename.replace(/\.pdf$/, ''), failOnCancel: false});
    } catch (e) {setError(e.message);} finally {setBusy(false);}
  }
  const button = (label, action, secondary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={action} style={[s.button, secondary && s.secondary, busy && {opacity: 0.5}]}><Text style={secondary ? s.secondaryText : s.buttonText}>{label}</Text></Pressable>;
  const input = (label, value, change, multiline = false, numeric = false) => <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} editable={!busy} style={[s.input, multiline && s.multiline]} value={value} onChangeText={change} multiline={multiline} keyboardType={numeric ? 'number-pad' : 'default'} placeholderTextColor={t.muted}/></View>;
  const update = (key, value) => setForm(current => ({...current, [key]: value, ...(key === 'branchId' ? {classId: '', sectionId: '', subjectId: ''} : key === 'classId' ? {sectionId: ''} : {})}));
  const choose = (label, key, options) => <View style={s.field}><Text style={s.label}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{options.length ? options.map(row => <Pressable key={String(row._id || row.id)} accessibilityRole="button" accessibilityState={{selected: form[key] === String(row._id || row.id)}} onPress={() => update(key, String(row._id || row.id))} style={[s.chip, form[key] === String(row._id || row.id) && s.active]}><Text style={form[key] === String(row._id || row.id) ? s.buttonText : s.secondaryText}>{row.name}</Text></Pressable>) : <Text style={s.muted}>No authorized options available.</Text>}</ScrollView></View>;
  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    {button('Back to workspace', onBack, true)}
    <Text style={s.title}>Exam papers</Text><Text style={s.muted}>School templates, saved drafts and printable papers.</Text>
    <View style={s.tabs}>{['Papers', 'New paper', 'Templates'].map(name => <Pressable key={name} accessibilityRole="button" accessibilityLabel={name} onPress={() => {setTab(name); setSelectedPaper(null);}} style={[s.chip, tab === name && s.active]}><Text style={tab === name ? s.buttonText : s.secondaryText}>{name}</Text></Pressable>)}</View>
    {error ? <View accessibilityRole="alert" style={s.error}><Text style={s.errorText}>{error}</Text>{button('Retry loading', refresh, true)}</View> : null}
    {loading ? <ActivityIndicator size="large" color={t.primary}/> : <>
      {tab === 'Papers' && (selectedPaper ? <View style={s.card}><Text style={s.heading}>{selectedPaper.title}</Text><Text style={s.muted}>{selectedPaper.className} / {selectedPaper.sectionName} · {selectedPaper.subjectName}</Text><Text style={s.body}>{selectedPaper.durationMinutes} minutes · {selectedPaper.totalMarks} marks · Draft</Text><Text style={s.body}>{selectedPaper.instructions}</Text>{selectedPaper.questions.map((q, i) => <Text key={i} style={s.question}>{i + 1}. {q.text} [{q.marks} marks]</Text>)}{button('Export PDF / print from PDF viewer', () => exportPdf(selectedPaper))}{button('All papers', () => setSelectedPaper(null), true)}</View> : <>{papers.length ? papers.map(paper => <Pressable key={paper.id} accessibilityRole="button" accessibilityLabel={`Open paper ${paper.title}`} onPress={() => setSelectedPaper(paper)} style={s.card}><Text style={s.heading}>{paper.title}</Text><Text style={s.muted}>{paper.className} · {paper.subjectName}</Text><Text style={s.body}>{paper.totalMarks} marks · {paper.durationMinutes} minutes · {paper.status}</Text><Text style={s.link}>Open paper →</Text></Pressable>) : <View style={s.card}><Text style={s.heading}>Your first paper starts here</Text><Text style={s.muted}>Create a school template, then save an exam draft.</Text>{button('Create a paper', () => setTab('New paper'))}</View>}</>)}
      {tab === 'New paper' && <View style={s.card}>
        {input('Paper title', form.title, value => update('title', value))}
        {choose('Campus', 'branchId', catalog.branches)}
        {choose('Class', 'classId', catalog.classes.filter(row => String(row.branchId) === form.branchId))}
        {choose('Section', 'sectionId', catalog.sections.filter(row => String(row.classId) === form.classId))}
        {choose('Subject', 'subjectId', catalog.subjects.filter(row => String(row.branchId) === form.branchId))}
        {choose('Print template', 'templateId', templates)}
        {input('Duration in minutes', form.durationMinutes, value => update('durationMinutes', value), false, true)}
        {input('Total marks', form.totalMarks, value => update('totalMarks', value), false, true)}
        {input('Instructions', form.instructions, value => update('instructions', value), true)}
        {questions.map((q, index) => <View style={s.questionCard} key={index}>{input(`Question ${index + 1}`, q.text, value => setQuestions(rows => rows.map((row, i) => i === index ? {...row, text: value} : row)), true)}{input(`Marks for question ${index + 1}`, q.marks, value => setQuestions(rows => rows.map((row, i) => i === index ? {...row, marks: value} : row)), false, true)}{questions.length > 1 && button('Remove question', () => setQuestions(rows => rows.filter((_, i) => i !== index)), true)}</View>)}
        {questions.length < 100 && button('Add question', () => setQuestions(rows => [...rows, {text: '', marks: '1'}]), true)}
        {button(busy ? 'Saving…' : 'Save draft', save)}
      </View>}
      {tab === 'Templates' && <View style={s.card}><Text style={s.heading}>School print templates</Text><Text style={s.muted}>A4 or Letter, configurable margins, headers, footers and page numbers. Latin text is supported; other scripts need an embedded font.</Text>{templates.map(row => <View style={s.questionCard} key={row.id}><Text style={s.heading}>{row.name}</Text><Text style={s.muted}>{row.pageSize} · {row.margin} pt margins</Text></View>)}{user.role !== 'teacher' ? <>{input('Template name', template.name, value => setTemplate({...template, name: value}))}{input('School header', template.header, value => setTemplate({...template, header: value}), true)}{input('Footer', template.footer, value => setTemplate({...template, footer: value}), true)}<View style={s.tabs}>{['A4', 'LETTER'].map(size => <Pressable style={[s.chip, template.pageSize === size && s.active]} key={size} onPress={() => setTemplate({...template, pageSize: size})}><Text style={template.pageSize === size ? s.buttonText : s.secondaryText}>{size}</Text></Pressable>)}</View>{input('Margin in points (24–72)', template.margin, value => setTemplate({...template, margin: value}), false, true)}{button('Save template', save)}</> : <Text style={s.muted}>Ask your school administrator to add a template.</Text>}</View>}
    </>}
    {busy && <ActivityIndicator color={t.primary}/>}
  </ScrollView>;
}
const s = StyleSheet.create({page: {flex: 1, backgroundColor: t.background}, content: {padding: 20, paddingBottom: 50}, title: {fontSize: 29, fontWeight: '800', color: t.ink, marginTop: 15}, heading: {fontSize: 18, fontWeight: '700', color: t.ink}, muted: {color: '#687183', fontSize: 14, lineHeight: 21, marginVertical: 6}, body: {color: t.ink, marginVertical: 8, lineHeight: 22}, card: {backgroundColor: t.paper, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: t.border, marginVertical: 10}, field: {marginBottom: 15}, label: {color: t.ink, fontWeight: '600', marginBottom: 8}, input: {minHeight: 48, padding: 12, backgroundColor: '#F6F4EF', borderWidth: 1, borderColor: t.border, borderRadius: 12, color: t.ink}, multiline: {minHeight: 95, textAlignVertical: 'top'}, tabs: {flexDirection: 'row', flexWrap: 'wrap', marginVertical: 15}, chip: {padding: 13, borderRadius: 24, backgroundColor: t.lavender, marginRight: 8, marginBottom: 8}, active: {backgroundColor: t.primary}, button: {padding: 15, borderRadius: 16, backgroundColor: t.primary, marginTop: 12, alignItems: 'center', minHeight: 48}, buttonText: {color: '#fff', fontWeight: '700'}, secondary: {backgroundColor: t.lavender}, secondaryText: {color: t.primary, fontWeight: '700'}, error: {padding: 15, borderRadius: 14, backgroundColor: '#FFF0EF'}, errorText: {color: '#9B2828'}, questionCard: {padding: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, marginVertical: 10}, question: {fontSize: 15, color: t.ink, lineHeight: 23, paddingVertical: 10}, link: {color: t.primary, fontWeight: '600', marginTop: 10}});
