import React from 'react';
import { Page, Card, Title, Muted } from '../../../components/UI';

// Read-only: parent cannot record payments.
export default function ParentInvoiceDetailScreen({ route }) {
  const invoice = route.params.invoice;
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
