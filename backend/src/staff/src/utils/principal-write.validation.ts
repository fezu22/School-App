import {PRINCIPAL_TASK_PRIORITIES} from '../models/principalTask';
import {dateField, enumField, objectBody, objectIdField, textField} from './request-validation';

export const taskCreateBody = (value: unknown) => {
  const body = objectBody(value, ['title', 'description', 'priority', 'assignedTo', 'dueDate']);
  return {
    title: textField(body.title, 'task title', 150, 2),
    assignedTo: objectIdField(body.assignedTo, 'assigned user ID'),
    ...(body.description === undefined ? {} : {description: textField(body.description, 'task description', 2000)}),
    ...(body.priority === undefined ? {} : {priority: enumField(body.priority, 'task priority', Object.values(PRINCIPAL_TASK_PRIORITIES))}),
    ...(body.dueDate === undefined ? {} : {dueDate: dateField(body.dueDate, 'due date', true)}),
  };
};

export const taskActionBody = (value: unknown) => {
  const body = objectBody(value, ['action']);
  return {action: enumField(body.action, 'task action', ['start', 'complete', 'cancel'] as const)};
};

export const safetyActionBody = (value: unknown) => {
  const body = objectBody(value, ['action', 'assignedTo']);
  const action = enumField(body.action, 'safety alert action', ['assign', 'resolve', 'escalate'] as const);
  if (action !== 'assign' && Object.hasOwn(body, 'assignedTo')) {
    // Do not silently accept irrelevant fields on resolve/escalate.
    objectBody(body, ['action']);
  }
  return {action, ...(action === 'assign' ? {assignedTo: objectIdField(body.assignedTo, 'assigned user ID')} : {})};
};
