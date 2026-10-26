import React, { useMemo, useRef } from 'react';
import { findNodeHandle, StyleSheet } from 'react-native';
// Use the SDK's cached view registration, rather than registering native names
// again for each tile. Mount only after engine preparation.
export function ZegoVideo({ onReady }: { onReady: (handle: number) => void }) {
  const NativeView = useMemo(
    () =>
      (
        require('zego-express-engine-reactnative') as typeof import('zego-express-engine-reactnative')
      ).ZegoTextureView,
    [],
  );
  const ref = useRef<React.ComponentRef<typeof NativeView> | null>(null);
  return (
    <NativeView
      ref={ref}
      style={styles.video}
      onLayout={() => {
        const handle = findNodeHandle(ref.current);
        if (handle != null) onReady(handle);
      }}
    />
  );
}
const styles = StyleSheet.create({ video: { flex: 1, minHeight: 210 } });
