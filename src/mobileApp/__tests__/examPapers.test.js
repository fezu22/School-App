import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {Pressable} from 'react-native';
import ExamPapersPage from '../features/exams/ExamPapersPage';
import {authRequest} from '../shared/services/authRequest';
import Share from 'react-native-share';
jest.mock('../shared/services/authRequest', () => ({authRequest: jest.fn()}));
jest.mock('react-native-share', () => ({__esModule: true, default: {open: jest.fn()}}));
const paper = {id: 'paper-id', title: 'Maths test', className: 'Grade 8', sectionName: 'A', subjectName: 'Maths', durationMinutes: 60, totalMarks: 10, status: 'draft', questions: [{text: 'Explain fractions.', marks: 10}]};
const content = node => typeof node === 'string' ? node : node?.children?.map(content).join('') || '';
async function press(tree, label) {
  const target = tree.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === label)[0];
  expect(target).toBeDefined();
  await act(async () => {await target.props.onPress();});
}
beforeEach(() => {
  jest.clearAllMocks();
  authRequest.mockImplementation(path => Promise.resolve(path === '/exam-papers' ? [paper] : path.endsWith('/catalog') ? {branches: [], classes: [], sections: [], subjects: []} : path.endsWith('/pdf') ? {base64: 'JVBERg==', filename: 'exam-paper.pdf'} : []));
});
test('saved paper opens its preview and exports only the authenticated PDF response', async () => {
  let tree;
  await act(async () => {tree = Renderer.create(<ExamPapersPage user={{role: 'principal'}} onBack={jest.fn()}/>);});
  await press(tree, 'Open paper Maths test');
  expect(JSON.stringify(tree.toJSON())).toContain('Explain fractions.');
  await press(tree, 'Export PDF / print from PDF viewer');
  expect(authRequest).toHaveBeenCalledWith('/exam-papers/paper-id/pdf');
  expect(Share.open).toHaveBeenCalledWith(expect.objectContaining({url: 'data:application/pdf;base64,JVBERg==', failOnCancel: false}));
  await act(async () => tree.unmount());
});
test('unresolved school mapping shows an error rather than sample papers', async () => {
  authRequest.mockRejectedValue(new Error('The account needs a verified school mapping.'));
  let tree;
  await act(async () => {tree = Renderer.create(<ExamPapersPage user={{role: 'principal'}} onBack={jest.fn()}/>);});
  const view = JSON.stringify(tree.toJSON());
  expect(view).toContain('verified school mapping');
  expect(view).not.toContain('Maths test');
  expect(Share.open).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});
test('teacher template tab does not expose administrator template creation', async () => {
  let tree;
  await act(async () => {tree = Renderer.create(<ExamPapersPage user={{role: 'teacher'}} onBack={jest.fn()}/>);});
  await press(tree, 'Templates');
  expect(JSON.stringify(tree.toJSON())).toContain('Ask your school administrator');
  expect(tree.root.findAllByType(Pressable).some(node => content(node) === 'Save template')).toBe(false);
  await act(async () => tree.unmount());
});
