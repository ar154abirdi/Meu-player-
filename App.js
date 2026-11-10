import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, Image, StyleSheet,
  ActivityIndicator, StatusBar, Linking, Alert, BackHandler, Dimensions,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';

const G = '#1db954';
const W = Dimensions.get('window').width;
const fmt = (ms) => { const t = Math.floor((ms || 0) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const nome = (a) => a.filename.replace(/\.[^/.]+$/, '');

function Cover({ uri, size, style }) {
  const base = { width: size, height: size, borderRadius: size / 8 };
  if (uri) return <Image source={{ uri }} style={[base, style]} />;
  return (
    <View style={[base, { backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ fontSize: size / 2 }}>🎵</Text>
    </View>
  );
}

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [status, setStatus] = useState('loading');
  const [covers, setCovers] = useState({});
  const [playlists, setPlaylists] = useState([]);
  const [view, setView] = useState('songs'); // songs | playlists | detail
  const [openPl, setOpenPl] = useState(null);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [showPlayer, setShowPlayer] = useState(false);
  const [cur, setCur] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [loop, setLoop] = useState('off'); // off | all | one
  const sound = useRef(null);
  const queue = useRef([]);
  const idx = useRef(0);
  const token = useRef(0);
  const barW = useRef(1);
  const shuffleRef = useRef(false);
  const loopRef = useRef('off');
  shuffleRef.current = shuffle;
  loopRef.current = loop;

  useEffect(() => { init(); return () => { if (sound.current) sound.current.unloadAsync(); }; }, []);
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showPlayer) { setShowPlayer(false); return true; }
      if (view === 'detail') { setView('playlists'); return true; }
      return false;
    });
    return () => h.remove();
  }, [showPlayer, view]);

  async function init() {
    setStatus('loading');
    const perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
    if (!perm.granted) { setStatus('denied'); return; }
    await Audio.setAudioModeAsync({ staysActiveInBackground: true, shouldDuckAndroid: true, playsInSilentModeIOS: true });
    try {
      const raw = await AsyncStorage.getItem('data');
      if (raw) { const d = JSON.parse(raw); setCovers(d.covers || {}); setPlaylists(d.playlists || []); }
    } catch (e) {}
    let all = [], after, more = true;
    while (more) {
      const page = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 500, after });
      all = all.concat(page.assets); more = page.hasNextPage; after = page.endCursor;
    }
    setTracks(all.filter((a) => a.duration >= 30).sort((a, b) => a.filename.localeCompare(b.filename)));
    setStatus('ready');
  }

  function upd(c, p) {
    setCovers(c); setPlaylists(p);
    AsyncStorage.setItem('data', JSON.stringify({ covers: c, playlists: p })).catch(() => {});
  }

  function onStatus(st) {
    if (!st.isLoaded) return;
    setPlaying(st.isPlaying); setPos(st.positionMillis); setDur(st.durationMillis || 0);
    if (st.didJustFinish) step(1, true);
  }

  async function play(list, i) {
    if (!list.length) return;
    const n = ((i % list.length) + list.length) % list.length;
    queue.current = list; idx.current = n; setCur(list[n]); setPos(0);
    const tk = ++token.current;
    try {
      if (sound.current) { await sound.current.unloadAsync(); sound.current = null; }
      const { sound: sd } = await Audio.Sound.createAsync(
        { uri: list[n].uri }, { shouldPlay: true, progressUpdateIntervalMillis: 500 }, onStatus);
      if (tk !== token.current) { sd.unloadAsync(); return; }
      sound.current = sd;
    } catch (e) { setPlaying(false); }
  }

  function step(dir, auto) {
    const q = queue.current;
    if (!q.length) return;
    if (auto && loopRef.current === 'one') return play(q, idx.current);
    if (shuffleRef.current && q.length > 1 && dir > 0) {
      let r;
      do { r = Math.floor(Math.random() * q.length); } while (r === idx.current);
      return play(q, r);
    }
    const n = idx.current + dir;
    if (auto && n >= q.length && loopRef.current === 'off') { setPlaying(false); return; }
    play(q, n);
  }

  async function prev() {
    if (pos > 3000 && sound.current) await sound.current.setPositionAsync(0);
    else step(-1, false);
  }

  async function toggle() {
    if (!sound.current) return;
    const st = await sound.current.getStatusAsync();
    if (!st.isLoaded) return;
    if (st.isPlaying) await sound.current.pauseAsync(); else await sound.current.playAsync();
  }

  async function pickCover(a) {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (r.canceled) return;
    const dest = FileSystem.documentDirectory + 'cover_' + a.id + '_' + Date.now() + '.jpg';
    await FileSystem.copyAsync({ from: r.assets[0].uri, to: dest });
    upd({ ...covers, [a.id]: dest }, playlists);
  }

  function createPl() {
    const n = newName.trim();
    if (!n) return;
    upd(covers, [...playlists, { id: String(Date.now()), name: n, ids: [] }]);
    setNewName('');
  }
  function togglePl(pid, tid) {
    upd(covers, playlists.map((p) => p.id !== pid ? p : { ...p, ids: p.ids.includes(tid) ? p.ids.filter((x) => x !== tid) : [...p.ids, tid] }));
  }
  function delPl(p) {
    Alert.alert('Excluir playlist', `Excluir "${p.name}"?`, [
      { text: 'Cancelar' },
      { text: 'Excluir', style: 'destructive', onPress: () => { upd(covers, playlists.filter((x) => x.id !== p.id)); setView('playlists'); } },
    ]);
  }

  const row = (t, onPress, right) => (
    <TouchableOpacity style={s.row} onPress={onPress}>
      <Cover uri={covers[t.id]} size={44} style={{ marginRight: 12 }} />
      <Text style={[s.rowText, cur && cur.id === t.id && s.rowOn]} numberOfLines={1}>{nome(t)}</Text>
      {right}
    </TouchableOpacity>
  );

  if (status === 'loading') return (
    <View style={[s.c, s.center]}><ActivityIndicator size="large" color={G} /><Text style={s.sub}>Procurando suas músicas...</Text></View>
  );
  if (status === 'denied') return (
    <View style={[s.c, s.center]}>
      <Text style={s.title}>Preciso de permissão</Text>
      <Text style={s.sub}>Libere o acesso a músicas e áudio para o app encontrar suas faixas.</Text>
      <TouchableOpacity style={s.btn} onPress={() => Linking.openSettings()}><Text style={s.btnT}>Abrir configurações</Text></TouchableOpacity>
      <TouchableOpacity style={s.btn} onPress={init}><Text style={s.btnT}>Tentar de novo</Text></TouchableOpacity>
    </View>
  );

  if (showPlayer && cur) return (
    <View style={s.c}>
      <TouchableOpacity onPress={() => setShowPlayer(false)}><Text style={s.back}>⌄</Text></TouchableOpacity>
      <View style={{ alignItems: 'center', marginTop: 8 }}><Cover uri={covers[cur.id]} size={W * 0.8} /></View>
      <Text style={s.big} numberOfLines={2}>{nome(cur)}</Text>
      <TouchableOpacity style={[s.btn, { alignSelf: 'center', marginTop: 0 }]} onPress={() => pickCover(cur)}>
        <Text style={s.btnT}>📷 {covers[cur.id] ? 'Trocar foto' : 'Adicionar foto'}</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={1} style={s.barBox} onLayout={(e) => { barW.current = e.nativeEvent.layout.width; }}
        onPress={(e) => sound.current && dur && sound.current.setPositionAsync((e.nativeEvent.locationX / barW.current) * dur)}>
        <View style={s.bar}><View style={[s.fill, { width: dur ? `${(pos / dur) * 100}%` : '0%' }]} /></View>
      </TouchableOpacity>
      <View style={s.timeRow}><Text style={s.time}>{fmt(pos)}</Text><Text style={s.time}>{fmt(dur)}</Text></View>
      <View style={s.controls}>
        <TouchableOpacity onPress={() => setShuffle(!shuffle)}><Text style={[s.ico, { opacity: shuffle ? 1 : 0.35 }]}>🔀</Text></TouchableOpacity>
        <TouchableOpacity onPress={prev}><Text style={s.ctrl}>⏮</Text></TouchableOpacity>
        <TouchableOpacity style={s.play} onPress={toggle}><Text style={s.playT}>{playing ? '⏸' : '▶'}</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => step(1, false)}><Text style={s.ctrl}>⏭</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setLoop(loop === 'off' ? 'all' : loop === 'all' ? 'one' : 'off')}>
          <Text style={[s.ico, { opacity: loop === 'off' ? 0.35 : 1 }]}>{loop === 'one' ? '🔂' : '🔁'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const pl = playlists.find((p) => p.id === openPl);
  const plTracks = pl ? pl.ids.map((id) => tracks.find((t) => t.id === id)).filter(Boolean) : [];
  const open = (list, i) => { play(list, i); setShowPlayer(true); };

  return (
    <View style={s.c}>
      <StatusBar barStyle="light-content" />
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, view === 'songs' && s.tabOn]} onPress={() => setView('songs')}>
          <Text style={s.tabT}>🎵 Músicas</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, view !== 'songs' && s.tabOn]} onPress={() => setView('playlists')}>
          <Text style={s.tabT}>📂 Playlists</Text>
        </TouchableOpacity>
      </View>

      {view === 'songs' && (
        <FlatList data={tracks} keyExtractor={(t) => t.id}
          ListEmptyComponent={<Text style={s.sub}>Nenhuma música encontrada.</Text>}
          renderItem={({ item, index }) => row(item, () => open(tracks, index), <Text style={s.time}>{fmt(item.duration * 1000)}</Text>)} />
      )}

      {view === 'playlists' && (
        <View style={{ flex: 1 }}>
          <View style={s.newRow}>
            <TextInput style={s.input} placeholder="Nome da nova playlist" placeholderTextColor="#777" value={newName} onChangeText={setNewName} />
            <TouchableOpacity style={s.add} onPress={createPl}><Text style={s.btnT}>＋</Text></TouchableOpacity>
          </View>
          <FlatList data={playlists} keyExtractor={(p) => p.id}
            ListEmptyComponent={<Text style={s.sub}>Nenhuma playlist ainda. Crie uma acima.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.row} onPress={() => { setOpenPl(item.id); setEditing(false); setView('detail'); }}>
                <Text style={{ fontSize: 28, marginRight: 12 }}>📁</Text>
                <Text style={s.rowText} numberOfLines={1}>{item.name}</Text>
                <Text style={s.time}>{item.ids.length} músicas</Text>
              </TouchableOpacity>
            )} />
        </View>
      )}

      {view === 'detail' && pl && (
        <View style={{ flex: 1 }}>
          <Text style={s.head}>{pl.name}</Text>
          <View style={s.newRow}>
            <TouchableOpacity style={s.btn2} onPress={() => plTracks.length && open(plTracks, 0)}><Text style={s.btnT}>▶ Tocar</Text></TouchableOpacity>
            <TouchableOpacity style={s.btn2} onPress={() => setEditing(!editing)}><Text style={s.btnT}>{editing ? '✔ Concluir' : '✏️ Editar'}</Text></TouchableOpacity>
            <TouchableOpacity style={s.btn2} onPress={() => delPl(pl)}><Text style={s.btnT}>🗑</Text></TouchableOpacity>
          </View>
          {editing ? (
            <FlatList data={tracks} keyExtractor={(t) => t.id}
              renderItem={({ item }) => row(item, () => togglePl(pl.id, item.id), <Text style={{ fontSize: 20, color: G }}>{pl.ids.includes(item.id) ? '✓' : ''}</Text>)} />
          ) : (
            <FlatList data={plTracks} keyExtractor={(t) => t.id}
              ListEmptyComponent={<Text style={s.sub}>Playlist vazia. Toque em Editar para adicionar músicas.</Text>}
              renderItem={({ item, index }) => row(item, () => open(plTracks, index), null)} />
          )}
        </View>
      )}

      {cur && (
        <TouchableOpacity style={s.mini} onPress={() => setShowPlayer(true)}>
          <Cover uri={covers[cur.id]} size={40} style={{ marginRight: 12 }} />
          <Text style={[s.rowText, { color: '#fff' }]} numberOfLines={1}>{nome(cur)}</Text>
          <TouchableOpacity onPress={toggle}><Text style={s.miniBtn}>{playing ? '⏸' : '▶'}</Text></TouchableOpacity>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#121212', paddingTop: StatusBar.currentHeight || 40 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  sub: { color: '#b3b3b3', fontSize: 15, textAlign: 'center', margin: 24 },
  btn: { backgroundColor: G, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 24, marginTop: 14 },
  btn2: { flex: 1, backgroundColor: '#2a2a2a', paddingVertical: 10, borderRadius: 20, alignItems: 'center', marginHorizontal: 4 },
  btnT: { color: '#fff', fontWeight: '700' },
  tabs: { flexDirection: 'row', padding: 12 },
  tab: { flex: 1, padding: 12, borderRadius: 20, backgroundColor: '#222', alignItems: 'center', marginHorizontal: 4 },
  tabOn: { backgroundColor: G },
  tabT: { color: '#fff', fontWeight: '700' },
  head: { color: '#fff', fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  newRow: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#222', color: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginRight: 8 },
  add: { backgroundColor: G, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  rowText: { color: '#e5e5e5', fontSize: 15, flex: 1, marginRight: 12 },
  rowOn: { color: G, fontWeight: '700' },
  time: { color: '#888', fontSize: 12 },
  mini: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e1e', padding: 10, paddingHorizontal: 16 },
  miniBtn: { color: '#fff', fontSize: 28 },
  back: { color: '#fff', fontSize: 36, paddingHorizontal: 20 },
  big: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center', margin: 16 },
  barBox: { paddingVertical: 14, paddingHorizontal: 24 },
  bar: { height: 5, backgroundColor: '#444', borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: G },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 16, paddingHorizontal: 12 },
  ctrl: { color: '#fff', fontSize: 32 },
  ico: { color: '#fff', fontSize: 26 },
  play: { backgroundColor: G, width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  playT: { color: '#000', fontSize: 30 },
});
