import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function ParentFeesScreen({ navigation }) {
  const { items, loading, error, load } = useList('/parent/invoices');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Fees & receipts</Title>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No fee invoices yet." /> : items.map(i => (
        <Card key={i._id} onPress={() => navigation.navigate('InvoiceDetail', { invoice: i })}>
          <Label>{i.title}</Label>
          <Muted>
            {i.studentId?.name}
            {'\n'}PKR {(i.amount / 100).toLocaleString()} · Due {(i.balance / 100).toLocaleString()}
            {'\n'}{i.dueDate} · Tap for receipts
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
