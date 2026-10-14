import { useIsFocused } from 'expo-router';
import { clearSharedPayloads, getSharedPayloads, useIncomingShare } from 'expo-sharing';
import type { SharePayload } from 'expo-sharing';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { reproFlags } from '@/repro/flags';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

function ts() {
  return new Date().toISOString().slice(11, 23);
}

// Tabs keep screens mounted; mount the repro only while focused so each share
// that navigates here mounts useIncomingShare() fresh (like a pushed share screen).
export default function HandleShareScreen() {
  return useIsFocused() ? <HandleShare /> : null;
}

function HandleShare() {
  const hook = useIncomingShare();

  // Deterministic trigger: clear native before the hook's passive mount effect runs.
  const clearedEarly = useRef(false);
  useLayoutEffect(() => {
    if (reproFlags.clearEarly && !clearedEarly.current) {
      clearedEarly.current = true;
      clearSharedPayloads();
      log('useLayoutEffect: clearSharedPayloads() (clearEarly=ON)');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native state, polled.
  const [native, setNative] = useState<SharePayload[]>(() => getSharedPayloads());
  useEffect(() => {
    const id = setInterval(() => setNative(getSharedPayloads()), 1000);
    return () => clearInterval(id);
  }, []);

  const [logLines, setLogLines] = useState<string[]>([]);
  function log(line: string) {
    const entry = `${ts()} ${line}`;
    console.log(`[repro] ${entry}`);
    setLogLines((l) => [...l, entry]);
  }

  const mismatch = native.length === 0 && hook.sharedPayloads.length > 0;

  const hookJson = JSON.stringify(
    {
      sharedPayloads: hook.sharedPayloads,
      resolvedSharedPayloads: hook.resolvedSharedPayloads,
      isResolving: hook.isResolving,
      error: hook.error ? hook.error.message : null,
    },
    null,
    1
  );

  // Mirror state to logcat so it can be captured without the screen.
  const nativeJson = JSON.stringify(native);
  useEffect(() => {
    console.log(`[repro] ${ts()} STATE native=${nativeJson} hook=${hookJson.replace(/\n\s*/g, '')}`);
  }, [nativeJson, hookJson]);

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>useIncomingShare repro · clearEarly={String(reproFlags.clearEarly)}</Text>

        {mismatch ? (
          <Text style={styles.bad}>
            MISMATCH: native getSharedPayloads() is [] but hook.sharedPayloads has {hook.sharedPayloads.length}
          </Text>
        ) : (
          <Text style={styles.ok}>in sync</Text>
        )}
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>native getSharedPayloads() (1s poll)</Text>
            <Text style={styles.mono}>{JSON.stringify(native, null, 1)}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>useIncomingShare()</Text>
            <Text style={styles.mono}>{hookJson}</Text>
          </View>
        </View>
        <Button
          title="hook.clearSharedPayloads()"
          onPress={() => {
            hook.clearSharedPayloads();
            setNative(getSharedPayloads());
            log('hook.clearSharedPayloads() called');
          }}
        />

        <Text style={styles.label}>Log</Text>
        <Text style={styles.mono}>{logLines.join('\n') || '(empty)'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: 'white' },
  container: { padding: 8, gap: 8, paddingBottom: 120 },
  h1: { fontFamily: mono, fontWeight: 'bold', fontSize: 14 },
  label: { fontFamily: mono, fontSize: 11, fontWeight: 'bold', marginTop: 8 },
  mono: { fontFamily: mono, fontSize: 11, color: 'black' },
  bad: { fontFamily: mono, fontSize: 12, color: 'white', backgroundColor: '#c00', padding: 6 },
  ok: { fontFamily: mono, fontSize: 12, color: 'white', backgroundColor: '#080', padding: 6 },
  row: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
});
