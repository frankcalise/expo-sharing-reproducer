import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import {
  clearSharedPayloads,
  getResolvedSharedPayloadsAsync,
  getSharedPayloads,
  useIncomingShare,
} from 'expo-sharing';
import type { ResolvedSharePayload, SharePayload } from 'expo-sharing';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { reproFlags } from '@/repro/flags';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

function ts() {
  return new Date().toISOString().slice(11, 23);
}

function toFileUrl(uri: string) {
  // file:/data/... -> file:///data/...
  return uri.replace(/^file:\/(?!\/)/, 'file:///');
}

function errMsg(e: unknown) {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

// Tabs keep screens mounted; mount the repro only while focused so each share
// that navigates here mounts useIncomingShare() fresh (like a pushed share screen).
export default function HandleShareScreen() {
  return useIsFocused() ? <HandleShare /> : null;
}

function HandleShare() {
  const hook = useIncomingShare();

  // D. Bug 1 deterministic trigger: clear native before the hook's passive mount effect runs.
  const clearedEarly = useRef(false);
  useLayoutEffect(() => {
    if (reproFlags.clearEarly && !clearedEarly.current) {
      clearedEarly.current = true;
      clearSharedPayloads();
      log('useLayoutEffect: clearSharedPayloads() (clearEarly=ON)');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A. Native state, polled.
  const [native, setNative] = useState<SharePayload[]>(() => getSharedPayloads());
  useEffect(() => {
    const id = setInterval(() => setNative(getSharedPayloads()), 1000);
    return () => clearInterval(id);
  }, []);

  // Log
  const [logLines, setLogLines] = useState<string[]>([]);
  function log(line: string) {
    const entry = `${ts()} ${line}`;
    console.log(`[repro] ${entry}`);
    setLogLines((l) => [...l, entry]);
  }

  // Remember the last raw value seen, so section C can try it after a clear.
  const lastRaw = useRef<string | null>(null);
  const firstRaw = native[0]?.value ?? hook.sharedPayloads[0]?.value;
  useEffect(() => {
    if (firstRaw) lastRaw.current = firstRaw;
  }, [firstRaw]);

  const mismatch = native.length === 0 && hook.sharedPayloads.length > 0;

  const hookJson = JSON.stringify(
    {
      sharedPayloads: hook.sharedPayloads,
      resolvedSharedPayloads: hook.resolvedSharedPayloads,
      isResolving: hook.isResolving,
      error: hook.error ? errMsg(hook.error) : null,
    },
    null,
    1
  );

  // Dump state to logcat whenever it changes, so it can be captured without the screen.
  const nativeJson = JSON.stringify(native);
  useEffect(() => {
    console.log(`[repro] ${ts()} STATE native=${nativeJson} hook=${hookJson.replace(/\n\s*/g, '')}`);
  }, [nativeJson, hookJson]);

  async function clearThenResolve() {
    clearSharedPayloads();
    log('C1 clearSharedPayloads() done; awaiting getResolvedSharedPayloadsAsync()');
    try {
      const r = await getResolvedSharedPayloadsAsync();
      log(`C1 clear → resolve RESOLVED: ${JSON.stringify(r)}`);
    } catch (e) {
      log(`C1 clear → resolve REJECTED: ${errMsg(e)}`);
    }
  }

  async function resolveParallelClear() {
    const p = getResolvedSharedPayloadsAsync();
    clearSharedPayloads();
    log('C2 started resolve, then clearSharedPayloads() immediately');
    try {
      const r = await p;
      log(`C2 resolve ∥ clear RESOLVED: ${JSON.stringify(r)}`);
    } catch (e) {
      log(`C2 resolve ∥ clear REJECTED: ${errMsg(e)}`);
    }
  }

  const [rawProbe, setRawProbe] = useState<string | null>(null);
  async function loadRawValue() {
    const raw = lastRaw.current;
    clearSharedPayloads();
    log(`C3 clearSharedPayloads(); probing raw value ${raw}`);
    if (!raw) return;
    setRawProbe(raw);
    try {
      const res = await fetch(raw);
      log(`C3 fetch(raw) status=${res.status}`);
    } catch (e) {
      log(`C3 fetch(raw) ERROR: ${errMsg(e)}`);
    }
  }

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>expo-sharing repro · clearEarly={String(reproFlags.clearEarly)}</Text>

        {/* A */}
        <Text style={styles.h2}>A. Native vs hook (bug 1)</Text>
        {mismatch ? (
          <Text style={styles.bad}>MISMATCH: native getSharedPayloads() is [] but hook.sharedPayloads has {hook.sharedPayloads.length}</Text>
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
        <Button title="Re-read native" onPress={() => setNative(getSharedPayloads())} />
        <Button
          title="hook.clearSharedPayloads()"
          onPress={() => {
            hook.clearSharedPayloads();
            setNative(getSharedPayloads());
            log('hook.clearSharedPayloads() called');
          }}
        />

        {/* B */}
        <Text style={styles.h2}>B. Resolved metadata (bug 2)</Text>
        {hook.resolvedSharedPayloads.length === 0 && <Text style={styles.mono}>(no resolved payloads)</Text>}
        {hook.resolvedSharedPayloads.map((p, i) => (
          <ResolvedItem key={i} index={i} payload={p} log={log} />
        ))}

        {/* C */}
        <Text style={styles.h2}>C. Ordering trap (bug 3)</Text>
        <Button title="clear → resolve" onPress={clearThenResolve} />
        <Button title="resolve ∥ clear" onPress={resolveParallelClear} />
        <Button title="load raw value (after clear)" onPress={loadRawValue} />
        {rawProbe && (
          <View>
            <Text style={styles.label}>Image of raw value: {rawProbe}</Text>
            <Image
              source={{ uri: rawProbe }}
              style={styles.img}
              onLoad={() => log('C3 Image(raw) onLoad')}
              onError={(e) => log(`C3 Image(raw) onError: ${e.error}`)}
            />
          </View>
        )}

        <Text style={styles.h2}>Log</Text>
        <Button title="Clear log" onPress={() => setLogLines([])} />
        <Text style={styles.mono} selectable>
          {logLines.join('\n') || '(empty)'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ResolvedItem({
  index,
  payload,
  log,
}: {
  index: number;
  payload: ResolvedSharePayload;
  log: (s: string) => void;
}) {
  const uri = payload.contentUri;
  const singleSlash = !!uri && uri.startsWith('file:/') && !uri.startsWith('file:///');
  const noExt = !!payload.originalName && !/\.[A-Za-z0-9]+$/.test(payload.originalName);
  const fixed = uri ? toFileUrl(uri) : null;

  async function doFetch() {
    for (const [label, u] of [
      ['raw', uri],
      ['file:///', fixed],
    ] as const) {
      if (!u) continue;
      try {
        const res = await fetch(u);
        log(`B[${index}] fetch(${label}) status=${res.status}`);
      } catch (e) {
        log(`B[${index}] fetch(${label}) ERROR: ${errMsg(e)}`);
      }
    }
  }

  return (
    <View style={styles.item}>
      <Text style={styles.mono}>
        {[
          'value',
          'shareType',
          'mimeType',
          'contentUri',
          'contentType',
          'contentSize',
          'contentMimeType',
          'originalName',
        ]
          .map((k) => `${k}: ${JSON.stringify((payload as Record<string, unknown>)[k])}`)
          .join('\n')}
      </Text>
      <Text style={singleSlash ? styles.bad : styles.ok}>
        contentUri single-slash file:/ (not file:///): {singleSlash ? 'YES' : 'no'}
      </Text>
      <Text style={noExt ? styles.bad : styles.ok}>
        originalName has no extension: {noExt ? 'YES' : 'no'}
      </Text>
      {uri && fixed && (
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Image raw contentUri</Text>
            <Image
              source={{ uri }}
              style={styles.img}
              onLoad={() => log(`B[${index}] Image(raw) onLoad`)}
              onError={(e) => log(`B[${index}] Image(raw) onError: ${e.error}`)}
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Image file:/// rewrite</Text>
            <Image
              source={{ uri: fixed }}
              style={styles.img}
              onLoad={() => log(`B[${index}] Image(file:///) onLoad`)}
              onError={(e) => log(`B[${index}] Image(file:///) onError: ${e.error}`)}
            />
          </View>
        </View>
      )}
      <Button title={`fetch() [${index}]`} onPress={doFetch} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: 'white' },
  container: { padding: 8, gap: 6, paddingBottom: 120 },
  h1: { fontFamily: mono, fontWeight: 'bold', fontSize: 14 },
  h2: { fontFamily: mono, fontWeight: 'bold', fontSize: 13, marginTop: 12, backgroundColor: '#eee' },
  label: { fontFamily: mono, fontSize: 10, fontWeight: 'bold' },
  mono: { fontFamily: mono, fontSize: 10, color: 'black' },
  bad: { fontFamily: mono, fontSize: 11, color: 'white', backgroundColor: '#c00', padding: 4 },
  ok: { fontFamily: mono, fontSize: 11, color: 'white', backgroundColor: '#080', padding: 4 },
  row: { flexDirection: 'row', gap: 6 },
  col: { flex: 1 },
  item: { borderWidth: 1, borderColor: '#999', padding: 4, gap: 4 },
  img: { width: '100%', height: 120, backgroundColor: '#ddd' },
});
