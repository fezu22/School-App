import React, { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { Page, Card, Title, Muted, Field, Button, Choice, ErrorText } from '../../../components/UI';

export default function StaffInvoiceDetailScreen({ route }) {
  const { user } = useAuth();
  const canPay = user.role === 'SUPER_ADMIN'; // principal is view-only
  const [invoice, setInvoice] = useState(route.params.invoice);
  const [amount, setAmount] = useState(''),
    [method, setMethod] = useState('CASH'),
    [reference, setReference] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [requestKey, setRequestKey] = useState(
      () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  async function pay() {
    if (!(Number(amount) > 0)) return setError('Enter a positive amount');
    Alert.alert('Record payment?', `PKR ${amount} · ${method}`, [
      { text: 'Cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setBusy(true);
          try {
            await api(`/staff/invoices/${invoice._id}/payments`, 'POST', {
              amount: Math.round(Number(amount) * 100),
              method,
              reference,
              requestKey,
            });
            setRequestKey(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
            const data = await api('/staff/invoices');
            setInvoice(data.items.find(i => i._id === invoice._id));
            setAmount('');
            Alert.alert('Payment recorded', 'Receipt appears below');
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }
  return (
    <Page>
      <Title>{invoice.title}</Title>
      <Muted>{invoice.studentId?.name} · Due {invoice.dueDate}</Muted>
      <Card>
        <Title>PKR {(invoice.balance / 100).toLocaleString()} due</Title>
        <Muted>
          Total {(invoice.amount / 100).toLocaleString()} · Paid {(invoice.paid / 100).toLocaleString()}
        </Muted>
      </Card>
      <ErrorText message={error} />
      {canPay && invoice.balance > 0 && (
        <Card>
          <Field label="Payment amount (PKR)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Choice
            label="Method"
            options={['CASH', 'BANK', 'CHEQUE'].map(v => ({ value: v, label: v }))}
            value={method}
            onChange={setMethod}
          />
          <Field label="Reference / cheque number" value={reference} onChangeText={setReference} />
          <Button title="Record payment" onPress={pay} busy={busy} />
        </Card>
      )}
      <Title>Receipt history</Title>
      {invoice.payments.map(p => (
        <Card key={p._id}>
          <Title>PKR {(p.amount / 100).toLocaleString()}</Title>
          <Muted>
            {p.method} · {new Date(p.createdAt).toLocaleString()}
            {'\n'}Receipt: {p._id}
            {'\n'}{p.reference}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
