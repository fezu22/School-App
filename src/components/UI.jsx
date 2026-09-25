import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { colors as c } from '../theme';
export function Page({ children, refreshControl }) {
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}
export function Card({ children, onPress }) {
  return onPress ? (
    <TouchableOpacity style={s.card} onPress={onPress}>
      {children}
    </TouchableOpacity>
  ) : (
    <View style={s.card}>{children}</View>
  );
}
export const Title = ({ children }) => <Text style={s.title}>{children}</Text>;
export const Label = ({ children }) => <Text style={s.label}>{children}</Text>;
export const Muted = ({ children }) => <Text style={s.muted}>{children}</Text>;
export function Field({
  label,
  value,
  onChangeText,
  password,
  multiline,
  keyboardType,
}) {
  return (
    <View style={s.field}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        style={[
          s.input,
          multiline && { height: 110, textAlignVertical: 'top' },
        ]}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={password}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        placeholder={label}
        placeholderTextColor="#8a97aa"
      />
    </View>
  );
}
export function Button({ title, onPress, busy, secondary, danger }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={busy}
      style={[
        s.button,
        secondary && s.secondary,
        danger && { backgroundColor: c.danger },
        busy && { opacity: 0.5 },
      ]}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? c.primary : '#fff'} />
      ) : (
        <Text style={[s.buttonText, secondary && { color: c.primary }]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}
export function Choice({ label, options, value, onChange, multiple = false }) {
  return (
    <View style={s.field}>
      <Label>{label}</Label>
      <View style={s.wrap}>
        {options.map(o => {
          const selected = multiple
            ? (value || []).includes(o.value)
            : value === o.value;
          return (
            <TouchableOpacity
              accessibilityRole="button"
              key={o.value}
              style={[s.chip, selected && s.selected]}
              onPress={() =>
                onChange(
                  multiple
                    ? selected
                      ? value.filter(x => x !== o.value)
                      : [...(value || []), o.value]
                    : o.value,
                )
              }
            >
              <Text style={{ color: selected ? '#fff' : c.text, fontSize: 13 }}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!options.length && (
        <Muted>No records yet. Create the required records first.</Muted>
      )}
    </View>
  );
}
export const ErrorText = ({ message }) =>
  message ? (
    <Text accessibilityRole="alert" style={s.error}>
      {message}
    </Text>
  ) : null;
export const Empty = ({ text = 'No records yet.' }) => (
  <Card>
    <Title>Nothing here yet</Title>
    <Muted>{text}</Muted>
  </Card>
);
export const Busy = () => (
  <ActivityIndicator style={{ margin: 30 }} color={c.primary} />
);
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  content: { padding: 20, paddingBottom: 45 },
  card: {
    backgroundColor: c.paper,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: c.border,
  },
  title: { fontSize: 22, fontWeight: '800', color: c.text, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 6 },
  muted: { fontSize: 14, color: c.muted, lineHeight: 21 },
  field: { marginBottom: 15 },
  input: {
    backgroundColor: c.paper,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 13,
    color: c.text,
  },
  button: {
    backgroundColor: c.primary,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginVertical: 7,
  },
  secondary: { backgroundColor: '#E8EEFF' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#E9EDF4',
    margin: 3,
  },
  selected: { backgroundColor: c.primary },
  error: {
    color: c.danger,
    backgroundColor: '#FFF0EF',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
});
