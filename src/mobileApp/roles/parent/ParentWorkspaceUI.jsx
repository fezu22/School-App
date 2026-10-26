import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme as t } from '../../theme/hiraTheme';
import PageIcon from '../../shared/components/PageIcon';
import useParentChildren from '../../shared/hooks/useParentChildren';

export { default as useParentChildren } from '../../shared/hooks/useParentChildren';

export const rows = value => (Array.isArray(value) ? value : []);
export const recordId = value => String(value?.id || value?._id || '');
export const childName = child =>
  child?.fullName || child?.name || 'Your child';
export const childClass = child =>
  [
    child?.grade && `Class ${String(child.grade).replace(/^Grade\s*/i, '')}`,
    child?.section,
  ]
    .filter(Boolean)
    .join(' · ');
export const isPreview = enabled =>
  Boolean(enabled && typeof __DEV__ !== 'undefined' && __DEV__);
export function Action({ title, onPress, secondary, disabled, icon, label }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label || title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        u.action,
        secondary && u.secondary,
        disabled && u.disabled,
        pressed && u.pressed,
      ]}
    >
      {icon ? (
        <PageIcon
          name={icon}
          size={20}
          color={secondary ? t.primary : t.paper}
        />
      ) : null}
      <Text style={[u.actionText, secondary && u.secondaryText]}>{title}</Text>
    </Pressable>
  );
}
export function State({ title, detail, error, loading, onRetry }) {
  return (
    <View style={u.card}>
      {loading ? (
        <ActivityIndicator color={t.primary} />
      ) : (
        <PageIcon
          name={error ? 'help' : 'folder'}
          size={32}
          color={t.primary}
        />
      )}
      <Text accessibilityRole={error ? 'alert' : undefined} style={u.cardTitle}>
        {title}
      </Text>
      {detail ? <Text style={u.muted}>{detail}</Text> : null}
      {onRetry ? (
        <Action title="Try again" secondary onPress={onRetry} />
      ) : null}
    </View>
  );
}
export function Hero({ title, subtitle, icon = 'book' }) {
  return (
    <View style={u.hero}>
      <View style={u.flex}>
        <Text style={u.heroTitle}>{title}</Text>
        <Text style={u.heroCopy}>{subtitle}</Text>
      </View>
      <View style={u.heroArt}>
        <Image
          source={require('../../assets/school-art.webp')}
          style={u.art}
          resizeMode="contain"
        />
        <View style={u.heroBadge}>
          <PageIcon name={icon} size={23} color={t.primary} />
        </View>
      </View>
    </View>
  );
}
export function ChildSelector({ model, disabled = false }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (model.loading || disabled) setOpen(false);
  }, [model.loading, disabled]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch child"
        disabled={disabled || model.loading || !model.children.length}
        onPress={() => setOpen(true)}
        style={u.selector}
      >
        <View style={u.avatar}>
          <PageIcon name="users" size={27} color={t.primary} />
        </View>
        <View style={u.flex}>
          <Text style={u.cardTitle}>{childName(model.selected)}</Text>
          <Text style={u.muted}>{childClass(model.selected)}</Text>
        </View>
        <PageIcon name="chevron-down" size={19} color={t.primary} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={u.overlay}>
          <View style={u.sheet}>
            <Text style={u.title}>Choose your child</Text>
            <ScrollView>
              {model.children.map(child => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${childName(child)}`}
                  key={recordId(child)}
                  style={u.selector}
                  onPress={() => {
                    model.select(child);
                    setOpen(false);
                  }}
                >
                  <Text style={u.cardTitle}>{childName(child)}</Text>
                  <Text style={u.muted}>{childClass(child)}</Text>
                  {recordId(child) === model.selectedId ? (
                    <PageIcon name="check" size={20} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
            <Action title="Close" secondary onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
export function PreviewNote({ visible }) {
  return visible ? (
    <Text style={u.preview}>DESIGN PREVIEW · SAMPLE RECORDS</Text>
  ) : null;
}
export const u = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: t.background },
  modalPage: { paddingTop: 28 },
  messageInput: { minHeight: 150 },
  stack: { gap: 16 },
  horizontalPadding: { paddingHorizontal: 18 },
  page: { paddingHorizontal: 18, paddingBottom: 24, gap: 16 },
  card: {
    backgroundColor: t.paper,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: t.border,
    padding: 18,
    gap: 12,
    ...t.shadow,
  },
  title: { color: t.ink, fontSize: 23, fontWeight: '800' },
  cardTitle: { color: t.ink, fontSize: 17, fontWeight: '700' },
  muted: { color: '#727169', fontSize: 13, lineHeight: 20 },
  body: { color: t.ink, fontSize: 14, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.paper,
    padding: 12,
    minHeight: 64,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 20,
    backgroundColor: t.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    backgroundColor: t.primary,
    borderRadius: 18,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  actionText: { color: t.paper, fontSize: 14, fontWeight: '700' },
  secondary: {
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
  },
  secondaryText: { color: t.primary },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  hero: {
    backgroundColor: t.lavender,
    borderRadius: 24,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: t.ink, lineHeight: 28 },
  heroCopy: { color: '#60627E', fontSize: 13, lineHeight: 20, marginTop: 8 },
  heroArt: { width: 92, height: 104 },
  art: { width: 92, height: 104 },
  heroBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    padding: 8,
    borderRadius: 16,
    backgroundColor: t.gold,
  },
  preview: { fontSize: 10, color: '#77746D', letterSpacing: 1 },
  overlay: {
    flex: 1,
    backgroundColor: '#28294066',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: t.background,
    borderRadius: 24,
    padding: 20,
    gap: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 16,
    backgroundColor: t.paper,
    padding: 14,
    fontSize: 15,
    color: t.ink,
    minHeight: 50,
  },
  label: { fontSize: 13, fontWeight: '700', color: t.ink },
  error: { color: '#A33D4A', fontSize: 13, lineHeight: 20 },
  badge: {
    backgroundColor: t.gold,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, color: t.ink, fontWeight: '600' },
  success: { backgroundColor: '#E8F3E9' },
  chip: {
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 17,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 20,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: t.lavender, borderColor: t.lavender },
  chipText: { fontSize: 13, color: t.primary, fontWeight: '600' },
  metric: {
    flex: 1,
    backgroundColor: '#F6F5FC',
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  divider: { height: 1, backgroundColor: t.border },
  back: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  link: { color: t.primary, fontSize: 13, fontWeight: '700' },
});
