import { parentApi } from '../roles/parent/parentService';
import { studentApi } from '../roles/student/studentService';
import { financeApi } from '../roles/finance/financeService';
const rows = data => (Array.isArray(data) ? data : []);
function record(item, index) {
  return {
    ...item,
    id: item.id || item._id || `record-${index}`,
    title:
      item.title ||
      item.examName ||
      item.subject ||
      item.student ||
      item.description ||
      item.name ||
      'Record',
    subtitle: [item.grade, item.date, item.dueDate, item.status]
      .filter(Boolean)
      .join(' · '),
    body:
      item.teacherFeedback || item.feedback || item.body || item.message || '',
    value: typeof item.progress === 'number' ? item.progress : undefined,
  };
}
function matchesText(value, term) {
  if (!term) return true;
  return String(value ?? '')
    .toLowerCase()
    .includes(String(term).trim().toLowerCase());
}
function filterRows(data, filters, fields) {
  return rows(data).filter(item =>
    fields.every(([filter, keys]) => {
      const value = filters?.[filter];
      if (!String(value || '').trim()) return true;
      return keys.some(key => matchesText(item[key], value));
    }),
  );
}
async function childId(preferred) {
  const children = await parentApi.getChildren();
  const verified = preferred
    ? rows(children).find(child => child.id === preferred)
    : rows(children)[0];
  return verified?.id;
}
function currencyTotals(items, field) {
  const totals = new Map();
  rows(items).forEach(item => {
    const currency = item.currency || 'PKR';
    const cents = Math.round(Number(item[field] || 0) * 100);
    totals.set(currency, (totals.get(currency) || 0) + cents);
  });
  return (
    [...totals.entries()]
      .map(
        ([currency, cents]) =>
          `${currency} ${(cents / 100).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`,
      )
      .join(' · ') || '—'
  );
}
export function getFeatureProvider(role, page, preferredChild) {
  const academic = [
    'Academic Report',
    'Student Progress Tracking',
    'Monthly Feedback',
  ];
  if (role === 'Student' && academic.includes(page))
    return {
      load: async (filters = {}) => {
        const data =
          page === 'Academic Report'
            ? await studentApi.getResults()
            : await studentApi.getProgress();
        const fields =
          page === 'Academic Report'
            ? [
                ['Subject', ['subject']],
                ['Term', ['term', 'termName', 'examName']],
                ['Session', ['session', 'academicSession', 'schoolYear']],
              ]
            : page === 'Monthly Feedback'
            ? [
                [
                  'Month',
                  ['month', 'period', 'date', 'createdAt', 'updatedAt'],
                ],
                ['Teacher', ['teacher', 'teacherName']],
              ]
            : [
                ['Subject', ['subject', 'area']],
                ['Period', ['period', 'date', 'createdAt', 'updatedAt']],
              ];
        return { records: filterRows(data, filters, fields).map(record) };
      },
    };
  if (
    role === 'Parent' &&
    [
      'Academic Report',
      'Monthly Feedback',
      'Student Progress Tracking',
      'Personal & Behaviour Report',
    ].includes(page)
  )
    return {
      load: async (filters = {}) => {
        const id = await childId(preferredChild);
        if (!id) return { records: [] };
        if (page === 'Academic Report') {
          const fields = [
            ['Subject', ['subject']],
            ['Term', ['term', 'termName', 'examName']],
            ['Session', ['session', 'academicSession', 'schoolYear']],
          ];
          return {
            records: filterRows(
              await parentApi.getResults(id),
              filters,
              fields,
            ).map(record),
          };
        }
        if (page === 'Personal & Behaviour Report') {
          const progress = rows(await parentApi.getProgress(id));
          const behaviour = progress.filter(item =>
            /behavio[u]?r|personal|wellbeing/.test(
              String(
                item.category || item.type || item.area || '',
              ).toLowerCase(),
            ),
          );
          return {
            records: filterRows(behaviour, filters, [
              ['Month', ['month', 'period', 'date']],
              ['Session', ['session', 'academicSession']],
            ]).map(record),
          };
        }
        const feedback = await parentApi.getFeedback(id);
        const progress = rows(feedback?.progress);
        const records =
          page === 'Student Progress Tracking'
            ? progress
            : [
                ...progress,
                ...rows(feedback?.results),
                ...rows(feedback?.homework),
              ];
        const fields =
          page === 'Student Progress Tracking'
            ? [
                ['Subject', ['subject', 'area']],
                ['Period', ['period', 'date', 'createdAt', 'updatedAt']],
              ]
            : [
                ['Month', ['month', 'date', 'createdAt', 'publishedAt']],
                ['Teacher', ['teacher', 'teacherName']],
              ];
        return { records: filterRows(records, filters, fields).map(record) };
      },
    };
  if (role === 'Parent' && ['Student Fees', 'Receipt Details'].includes(page))
    return {
      load: async () => {
        const id = await childId(preferredChild);
        if (!id) return { records: [], metrics: null };
        const invoices = rows(await parentApi.getFees(id));
        if (page === 'Student Fees') {
          return {
            metrics: {
              'Confirmed paid': currencyTotals(invoices, 'confirmedPaidAmount'),
              'Pending verification': currencyTotals(invoices, 'pendingAmount'),
              'Due (pending unpaid)': currencyTotals(invoices, 'balanceDue'),
            },
            records: invoices.map((invoice, index) => ({
              ...record(invoice, index),
              title:
                invoice.description ||
                invoice.invoiceNumber ||
                invoice.id ||
                'Invoice',
              subtitle: [
                invoice.dueDate &&
                  `Due ${String(invoice.dueDate).slice(0, 10)}`,
                invoice.status,
              ]
                .filter(Boolean)
                .join(' · '),
              body: `Amount: ${invoice.currency || 'PKR'} ${Number(
                invoice.amount || 0,
              ).toFixed(2)} · Confirmed paid: ${Number(
                invoice.confirmedPaidAmount || 0,
              ).toFixed(2)} · Pending verification: ${Number(
                invoice.pendingAmount || 0,
              ).toFixed(2)} · Due (pending not yet confirmed): ${Number(
                invoice.balanceDue || 0,
              ).toFixed(2)} · Remaining after pending: ${Number(
                invoice.availableBalance ?? invoice.balanceDue ?? 0,
              ).toFixed(2)}`,
            })),
          };
        }
        const receipts = invoices.flatMap(invoice =>
          rows(invoice.confirmedReceipts).map(receipt => ({
            ...receipt,
            id: receipt.paymentId,
            invoiceId: invoice.id || invoice.invoiceNumber,
            title: receipt.receiptNumber || 'Confirmed receipt',
            subtitle: `${
              invoice.description ||
              invoice.invoiceNumber ||
              invoice.id ||
              'Invoice'
            } · ${
              receipt.confirmedAt
                ? new Date(receipt.confirmedAt).toLocaleDateString()
                : 'Confirmation date unavailable'
            }`,
            body: `Amount: ${
              receipt.currency || invoice.currency || 'PKR'
            } ${Number(receipt.amount || 0).toFixed(2)} · Method: ${
              receipt.method || 'Not recorded'
            } · Status: Confirmed`,
            status: 'Confirmed',
          })),
        );
        return { records: receipts };
      },
    };
  if (role === 'Student' && page === 'Student Fees')
    return {
      load: async () => {
        const invoices = rows(await studentApi.getFees());
        return {
          metrics: {
            'Confirmed paid': currencyTotals(invoices, 'confirmedPaidAmount'),
            'Pending verification': currencyTotals(invoices, 'pendingAmount'),
            'Due (pending unpaid)': currencyTotals(invoices, 'balanceDue'),
          },
          records: invoices.map((invoice, index) => ({
            ...record(invoice, index),
            title:
              invoice.description ||
              invoice.invoiceNumber ||
              invoice.id ||
              'Invoice',
            subtitle: [
              invoice.dueDate && `Due ${String(invoice.dueDate).slice(0, 10)}`,
              invoice.status,
            ]
              .filter(Boolean)
              .join(' · '),
            body: `Amount: ${invoice.currency || 'PKR'} ${Number(
              invoice.amount || 0,
            ).toFixed(2)} · Confirmed paid: ${Number(
              invoice.confirmedPaidAmount || 0,
            ).toFixed(2)} · Pending verification: ${Number(
              invoice.pendingAmount || 0,
            ).toFixed(2)} · Due (pending not yet confirmed): ${Number(
              invoice.balanceDue || 0,
            ).toFixed(2)} · Remaining after pending: ${Number(
              invoice.availableBalance ?? invoice.balanceDue ?? 0,
            ).toFixed(2)}`,
          })),
        };
      },
    };
  if (role === 'Finance' && page === 'Student Ledger')
    return {
      load: async filters => {
        const response = await financeApi.getDues({
          studentId: filters['Student ID'],
          from: filters['From date'],
          to: filters['To date'],
          method: filters['Payment method'],
        });
        return {
          records: rows(response.data).map((item, i) => ({
            ...record(item, i),
            body: `Confirmed paid: ${item.paidAmount ?? '—'} · Pending: ${
              item.pendingAmount ?? '—'
            } · Due: ${item.balanceDue ?? '—'} · Methods: ${
              (item.paymentMethods || []).join(', ') || '—'
            }`,
          })),
        };
      },
    };
  if (role === 'Finance' && page === 'Voucher Scan')
    return {
      submit: async form => {
        const response = await financeApi.verifyVoucher(form['Voucher code']);
        return {
          notice: 'Voucher verified against the authorized Finance branch.',
          records: [
            {
              ...response.data,
              title: response.data?.student || 'Voucher',
              subtitle: response.data?.voucherCode,
              body: `Paid: ${response.data?.paidAmount ?? '—'} · Pending: ${
                response.data?.pendingAmount ?? '—'
              } · Due: ${response.data?.balanceDue ?? '—'}`,
            },
          ],
        };
      },
    };
  if (role === 'Finance' && page === 'Receipt Details')
    return {
      submit: async form => {
        const response = await financeApi.getReceipt(form['Payment ID']);
        const receipt = response.data;
        return {
          notice:
            'Confirmed receipt loaded from the authorized Finance branch.',
          records: [
            {
              ...receipt,
              title: receipt?.receiptNumber || 'Receipt',
              subtitle: receipt?.invoiceId,
              body: `Amount: ${receipt?.currency || ''} ${
                receipt?.amount ?? '—'
              } · Payment: ${receipt?.paymentId || form['Payment ID']}`,
            },
          ],
        };
      },
    };
  if (page === 'Attendance Calendar' && ['Student', 'Parent'].includes(role))
    return {
      load: async (filters = {}) => {
        const id = role === 'Parent' ? await childId(preferredChild) : null;
        if (role === 'Parent' && !id) return { records: [] };
        const data =
          role === 'Parent'
            ? await parentApi.getAttendance(id, {
                from: filters['From date'],
                to: filters['To date'],
              })
            : await studentApi.getAttendance({
                from: filters['From date'],
                to: filters['To date'],
              });
        return {
          records: rows(data).map((item, index) => ({
            ...record(item, index),
            title: item.status || 'Attendance',
            date: item.date,
          })),
        };
      },
    };
  if (page === 'Leave Request' && ['Student', 'Parent'].includes(role))
    return {
      submit: async form => {
        const dates = [form['From date'], form['To date']];
        if (
          dates.some(
            date =>
              !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
              !Number.isFinite(Date.parse(date)),
          ) ||
          dates[1] < dates[0]
        )
          throw new Error(
            'Enter valid YYYY-MM-DD dates, with the end date after the start date.',
          );
        const application = {
          title: 'Leave request',
          message: `From ${dates[0]} to ${dates[1]}: ${form.Reason}`,
        };
        if (role === 'Student') await studentApi.submitApplication(application);
        else {
          const id = await childId(preferredChild);
          if (!id) throw new Error('No verified child is linked.');
          await parentApi.submitApplication(id, application);
        }
        return {
          records: [],
          notice: 'Leave application submitted to the assigned class teacher.',
        };
      },
    };
  if (role === 'Finance' && page === 'Finance Reports')
    return {
      load: async filters => {
        const response = await financeApi.getCollectionReport({
          from: filters['From date'],
          to: filters['To date'],
          studentId: filters['Student ID'],
          method: filters['Payment method'],
        });
        return {
          records: [
            ...rows(response.data?.confirmedCollections).map(item => ({
              id: `total-${item._id || 'PKR'}`,
              title: `Confirmed collections · ${item._id || 'PKR'}`,
              body: `${item._id || 'PKR'} ${Number(item.total || 0).toFixed(
                2,
              )} · ${item.count} confirmed payments`,
              status: 'Total',
            })),
            ...rows(response.data?.byMethod).map((item, index) => ({
              id: `${item.currency || 'PKR'}-${item._id || index}`,
              title: `${item._id || 'Unspecified'} · ${item.currency || 'PKR'}`,
              body: `Confirmed amount: ${item.currency || 'PKR'} ${Number(
                item.total || 0,
              ).toFixed(2)} · Transactions: ${item.count}`,
              status: 'Confirmed',
            })),
          ],
        };
      },
    };
  if (['Student', 'Parent'].includes(role)) {
    const withLearner = async callback => {
      if (role === 'Student') return callback(studentApi, null);
      const id = await childId(preferredChild);
      if (!id) throw new Error('No verified child is linked.');
      return callback(parentApi, id);
    };
    const invoke = (api, id, method, ...args) =>
      id ? api[method](id, ...args) : api[method](...args);
    const mapped = data => rows(data).map(record);

    if (page === 'Academic Calendar')
      return { load: async () => ({ records: mapped(await withLearner((api, id) => invoke(api, id, 'getCalendar'))) }) };
    if (['School Events', 'Sports & Activities'].includes(page))
      return {
        load: async filters => {
          const data = await withLearner((api, id) => invoke(api, id, 'getEvents'));
          const category = page === 'Sports & Activities' ? /sport|club|activity/i : null;
          return { records: mapped(rows(data).filter(item => !category || category.test(String(item.type || item.category || ''))).filter(item => !filters?.Type || matchesText(item.type || item.category, filters.Type))) };
        },
        requestRecord: item => withLearner((api, id) => invoke(api, id, 'requestEvent', item.id || item._id)),
      };
    if (page === 'PTM & Appointments')
      return {
        load: async () => ({ records: mapped(await withLearner((api, id) => invoke(api, id, 'getPtm'))) }),
        submit: async form => {
          await withLearner((api, id) => invoke(api, id, 'requestPtm', { teacherId: form.Teacher, date: form.Date, reason: form.Reason }));
          return { records: [], notice: 'Appointment request saved for staff review.' };
        },
      };
    if (['Learning Resources', 'Recorded Lessons'].includes(page))
      return {
        load: async filters => ({ records: mapped(await withLearner((api, id) => invoke(api, id, 'getResources', page === 'Recorded Lessons' ? 'recorded_lesson' : undefined))).filter(item => !filters?.Subject || matchesText(item.subject, filters.Subject)) }),
        updateProgress: role === 'Student' ? (item, percent) => studentApi.updateResourceProgress(item.id || item._id, percent) : undefined,
      };
    if (role === 'Student' && page === 'Notes & Flashcards')
      return {
        load: async () => ({ records: mapped(await studentApi.getNotes()) }),
        submit: async form => { await studentApi.saveNote({ subject: form.Subject, title: form.Title, note: form.Note }); return { records: mapped(await studentApi.getNotes()), notice: 'Note saved.' }; },
      };
    if (role === 'Student' && page === 'Revision Planner')
      return {
        load: async () => ({ records: mapped(await studentApi.getRevisionPlans()) }),
        submit: async form => { await studentApi.saveRevisionPlan({ subject: form.Subject, topic: form.Topic, studyDate: form['Study date'], duration: form.Duration }); return { records: mapped(await studentApi.getRevisionPlans()), notice: 'Study session saved.' }; },
      };
    if (role === 'Student' && page === 'Quiz')
      return {
        load: async () => {
          const quizzes = rows(await studentApi.getQuizzes());
          return { records: quizzes.map((quiz, index) => {
            const question = rows(quiz.questions)[0] || {};
            return { ...record(quiz, index), quizId: quiz.id || quiz._id, questionId: String(question.id ?? 0), question: question.prompt || question.question || quiz.title, options: rows(question.options).map(option => typeof option === 'object' ? option.label || option.text || option.id : option), optionValues: rows(question.options).map(option => typeof option === 'object' ? option.id : option) };
          }) };
        },
        submitQuiz: (item, choice) => {
          const index = item.options.indexOf(choice);
          return studentApi.submitQuiz(item.quizId, { [item.questionId]: item.optionValues[index] });
        },
      };
    if (page === 'Documents & Consent')
      return {
        load: async () => ({ records: mapped(await withLearner((api, id) => invoke(api, id, 'getDocuments'))) }),
        recordConsent: role === 'Parent' ? (item, decision) => parentApi.recordConsent(preferredChild, item.id || item._id, item.version, decision) : undefined,
      };
    if (page === 'Helpdesk')
      return {
        load: async () => ({ records: mapped(await withLearner((api, id) => invoke(api, id, 'getHelpdeskTickets'))) }),
        submit: async form => { await withLearner((api, id) => invoke(api, id, 'createHelpdeskTicket', { category: form.Category, subject: form.Subject, message: form.Message })); return { records: [], notice: 'Helpdesk ticket created.' }; },
      };
    if (page === 'Travel History')
      return { load: async () => ({ records: mapped(await withLearner((api, id) => invoke(api, id, 'getTransportHistory'))) }) };
    if (['Track My Child', 'Transport & Alerts'].includes(page))
      return { load: async () => {
        const item = await withLearner((api, id) => invoke(api, id, 'getTransportTracking'));
        return { records: item ? mapped([item]) : [] };
      } };
  }
  return undefined;
}
