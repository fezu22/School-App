import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import PageIcon from './PageIcon';

export default function SchoolPageHero({ title, subtitle, icon = 'school' }) {
  return (
    <View style={styles.hero}>
      <View style={styles.copy}>
        <View style={styles.badge}>
          <PageIcon name={icon} size={22} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Image
        accessibilityIgnoresInvertColors
        accessible={false}
        source={require('../../assets/school-art.webp')}
        resizeMode="contain"
        style={styles.art}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: '#EEEDFF',
    borderRadius: 24,
    padding: 18,
    marginVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  copy: { flex: 1, paddingRight: 8 },
  badge: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  title: { color: '#282940', fontSize: 21, lineHeight: 27, fontWeight: '800' },
  subtitle: { color: '#65657B', fontSize: 12, lineHeight: 18, marginTop: 7 },
  art: { width: '31%', height: 108 },
});
