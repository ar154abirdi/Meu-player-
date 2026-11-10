import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, StatusBar, Linking,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { Audio } from 'expo-av';

const fmt = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const nome = (a) => a.filename.replace(/\.[^/.]+$/, '');

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | denied | ready
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const sound = useRef(null);
  const tracksRef = useRef([]);
  const indexRef = useRef(-1);

  useEffect(() => {
    init();
    return () => { if (sound.current) sound.current.unloadAsync(); };
  }, []);

  async function init() {
    setStatus('loading');
    const perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
    if (!perm.granted) { setStatus('denied'); return; }
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playsInSilentModeIOS: true,
    });
    let all = [];
    let after;
    let more = true;
    while (more) {
      const page = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 500, after });
      all = all.concat(page.assets);
      more = page.hasNextPage;
      after = page.endCursor;
    }
    // ignora toques e sons curtos (menos de 30 segundos)
    const list = all
      .filter((a) => a.duration >= 30)
      .sort((a, b) => a.filename.localeCompare(b.filename));
    tracksRef.current = list;
    setTracks(list);
    setStatus('ready');
  }

  function onStatus(st) {
    if (!st.isLoaded) return;
    setPlaying(st.isPlaying);
    setPos(st.positionMillis);
    setDur(st.durationMillis || 0);
    if (st.didJustFinish) playAt(indexRef.current + 1);
  }

  async function playAt(i) {
    const list = tracksRef.current;
    if (!list.length) return;
    const n = (i + list.length) % list.length;
    try {
      if (sound.current) {
        await sound.current.unloadAsync();
        sound.current = null;
      }
      indexRef.current = n;
      setIndex(n);
      setPos(0);
      const { sound: s } = await Audio.Sound.createAsync(
        { uri: list[n].uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 500 },
        onStatus
      );
      sound.current = s;
    } catch (e) {
      setPlaying(false);
    }
  }

  async function toggle() {
    if (!sound.current) { playAt(Math.max(index, 0)); return; }
    const st = await sound.current.getStatusAsync();
    if (!st.isLoaded) return;
    if (st.isPlaying) await sound.current.pauseAsync();
    else await sound.current.playAsync();
  }

  if (status === 'loading') {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color="#1db954" />
        <Text style={s.sub}>Procurando suas músicas...</Text>
      </View>
    );
  }

  if (status === 'denied') {
    return (
      <View style={[s.container, s.center]}>
        <Text style={s.title}>Preciso de permissão</Text>
        <Text style={s.sub}>Libere o acesso a músicas e áudio para o app encontrar suas faixas.</Text>
        <TouchableOpacity style={s.btn} onPress={() => Linking.openSettings()}>
          <Text style={s.btnText}>Abrir configurações</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btn} onPress={init}>
          <Text style={s.btnText}>Tentar de novo</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const atual = index >= 0 ? tracks[index] : null;

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />
      <Text style={s.header}>Minhas músicas ({tracks.length})</Text>

      {tracks.length === 0 ? (
        <View style={s.center}>
          <Text style={s.sub}>Nenhuma música encontrada.</Text>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(t) => t.id}
          renderItem={({ item, index: i }) => (
            <TouchableOpacity style={s.row} onPress={() => playAt(i)}>
              <Text style={[s.rowText, i === index && s.rowActive]} numberOfLines={1}>
                {nome(item)}
              </Text>
              <Text style={s.time}>{fmt(item.duration * 1000)}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <View style={s.player}>
        <Text style={s.now} numberOfLines={1}>
          {atual ? nome(atual) : 'Escolha uma música'}
        </Text>
        <View style={s.bar}>
          <View style={[s.barFill, { width: dur ? `${(pos / dur) * 100}%` : '0%' }]} />
        </View>
        <View style={s.timeRow}>
          <Text style={s.time}>{fmt(pos)}</Text>
          <Text style={s.time}>{fmt(dur)}</Text>
        </View>
        <View style={s.controls}>
          <TouchableOpacity onPress={() => playAt(index - 1)} disabled={tracks.length === 0}>
            <Text style={s.ctrl}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.play} onPress={toggle} disabled={tracks.length === 0}>
            <Text style={s.playText}>{playing ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => playAt(index + 1)} disabled={tracks.length === 0}>
            <Text style={s.ctrl}>⏭</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingTop: StatusBar.currentHeight || 40 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, flex: 1 },
  header: { color: '#fff', fontSize: 22, fontWeight: '700', padding: 16 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  sub: { color: '#b3b3b3', fontSize: 15, textAlign: 'center', marginTop: 12 },
  btn: { backgroundColor: '#1db954', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24, marginTop: 16 },
  btnText: { color: '#000', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2a2a' },
  rowText: { color: '#e5e5e5', fontSize: 15, flex: 1, marginRight: 12 },
  rowActive: { color: '#1db954', fontWeight: '700' },
  time: { color: '#888', fontSize: 12 },
  player: { backgroundColor: '#1e1e1e', padding: 16, paddingBottom: 28, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  now: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  bar: { height: 4, backgroundColor: '#444', borderRadius: 2, marginTop: 14, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: '#1db954' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctrl: { color: '#fff', fontSize: 32, marginHorizontal: 28 },
  play: { backgroundColor: '#1db954', width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  playText: { color: '#000', fontSize: 28 },
});
