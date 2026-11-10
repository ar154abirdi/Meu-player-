import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, Image, StyleSheet, ScrollView, Switch,
  ActivityIndicator, StatusBar, Linking, Alert, BackHandler, Dimensions, AppState,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const G = '#1db954';
const W = Dimensions.get('window').width;
const THEMES = [
  { id: 'escuro', n: 'Escuro', c: '#121212' }, { id: 'noite', n: 'Noite', c: '#0d1b2a' },
  { id: 'roxo', n: 'Roxo', c: '#1e1033' }, { id: 'floresta', n: 'Floresta', c: '#0f2a1d' },
  { id: 'vinho', n: 'Vinho', c: '#2a0f1a' }, { id: 'grafite', n: 'Grafite', c: '#23272f' },
];
const BORDERS = ['#1db954', '#3b82f6', '#a855f7', '#ec4899', '#ef4444', '#f59e0b', '#eab308', '#06b6d4', '#ffffff'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DEF = { tabIcons: true, border: G, bgType: 'theme', theme: 'escuro', bgImage: null, lastRecap: null };
const fmt = (ms) => { const t = Math.floor((ms || 0) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const nome = (a) => a.filename.replace(/\.[^/.]+$/, '');
const mkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function Cover({ uri, size, bc, style }) {
  const b = { width: size, height: size, borderRadius: size / 3, borderWidth: bc ? Math.max(2, size / 28) : 0, borderColor: bc };
  if (uri) return <Image source={{ uri }} style={[b, style]} />;
  return (
    <View style={[b, { backgroundColor: '#2b2b2b', alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name="musical-notes" size={size / 2} color="#888" />
    </View>
  );
}

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [status, setStatus] = useState('loading');
  const [covers, setCovers] = useState({});
  const [playlists, setPlaylists] = useState([]);
  const [cfg, setCfg] = useState(DEF);
  const [recap, setRecap] = useState(null);
  const [view, setView] = useState('songs'); // songs | playlists | detail | settings
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
  const curRef = useRef(null);
  const lastPos = useRef(0);
  const ticks = useRef(0);
  const stats = useRef({});
  const shuffleRef = useRef(false);
  const loopRef = useRef('off');
  shuffleRef.current = shuffle;
  loopRef.current = loop;

  const saveStats = () => AsyncStorage.setItem('stats', JSON.stringify(stats.current)).catch(() => {});

  useEffect(() => {
    init();
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') saveStats(); });
    return () => { sub.remove(); if (sound.current) sound.current.unloadAsync(); };
  }, []);
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (recap) { closeRecap(); return true; }
      if (showPlayer) { setShowPlayer(false); return true; }
      if (view === 'detail') { setView('playlists'); return true; }
      if (view === 'settings') { setView('songs'); return true; }
      return false;
    });
    return () => h.remove();
  }, [showPlayer, view, recap, cfg]);

  async function init() {
    setStatus('loading');
    const perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
    if (!perm.granted) { setStatus('denied'); return; }
    await Audio.setAudioModeAsync({ staysActiveInBackground: true, shouldDuckAndroid: true, playsInSilentModeIOS: true });
    let c = DEF;
    try {
      const [d, cf, st] = await Promise.all([AsyncStorage.getItem('data'), AsyncStorage.getItem('settings'), AsyncStorage.getItem('stats')]);
      if (d) { const j = JSON.parse(d); setCovers(j.covers || {}); setPlaylists(j.playlists || []); }
      if (cf) { c = { ...DEF, ...JSON.parse(cf) }; setCfg(c); }
      if (st) stats.current = JSON.parse(st);
    } catch (e) {}
    const now = new Date();
    const pk = mkey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    if (stats.current[pk] && stats.current[pk].ms > 0 && c.lastRecap !== pk) setRecap({ key: pk, auto: true });
    let all = [], after, more = true;
    while (more) {
      const page = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 500, after });
      all = all.concat(page.assets); more = page.hasNextPage; after = page.endCursor;
    }
    setTracks(all.filter((a) => a.duration >= 30).sort((a, b) => a.filename.localeCompare(b.filename)));
    setStatus('ready');
  }

  function patch(p) {
    const n = { ...cfg, ...p };
    setCfg(n);
    AsyncStorage.setItem('settings', JSON.stringify(n)).catch(() => {});
  }
  function upd(c, p) {
    setCovers(c); setPlaylists(p);
    AsyncStorage.setItem('data', JSON.stringify({ covers: c, playlists: p })).catch(() => {});
  }
  function closeRecap() { if (recap && recap.auto) patch({ lastRecap: recap.key }); setRecap(null); }

  function addStat(ms) {
    const a = curRef.current;
    if (!a) return;
    const k = mkey(new Date());
    const m = stats.current[k] || (stats.current[k] = { ms: 0, t: {} });
    m.ms += ms;
    const t = m.t[a.id] || (m.t[a.id] = { n: nome(a), ms: 0 });
    t.ms += ms;
    if (++ticks.current % 20 === 0) saveStats();
  }

  function onStatus(st) {
    if (!st.isLoaded) return;
    if (st.isPlaying) { const d = st.positionMillis - lastPos.current; if (d > 0 && d < 3000) addStat(d); }
    lastPos.current = st.positionMillis;
    setPlaying(st.isPlaying); setPos(st.positionMillis); setDur(st.durationMillis || 0);
    if (st.didJustFinish) step(1, true);
  }

  async function play(list, i) {
    if (!list.length) return;
    const n = ((i % list.length) + list.length) % list.length;
    queue.current = list; idx.current = n; curRef.current = list[n]; lastPos.current = 0;
    setCur(list[n]); setPos(0);
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
    if (st.isPlaying) { await sound.current.pauseAsync(); saveStats(); } else await sound.current.playAsync();
  }

  async function pickImage(opts) {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, ...opts });
    if (r.canceled) return null;
    const dest = FileSystem.documentDirectory + 'img_' + Date.now() + '.jpg';
    await FileSystem.copyAsync({ from: r.assets[0].uri, to: dest });
    return dest;
  }
  async function pickCover(a) {
    const d = await pickImage({ allowsEditing: true, aspect: [1, 1] });
    if (d) upd({ ...covers, [a.id]: d }, playlists);
  }
  async function pickBg() {
    const d = await pickImage({});
    if (d) patch({ bgType: 'image', bgImage: d });
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

  const bgColor = (THEMES.find((t) => t.id === cfg.theme) || THEMES[0]).c;
  const screen = (children) => (
    <View style={[s.c, { backgroundColor: bgColor }]}>
      <StatusBar barStyle="light-content" />
      {cfg.bgType === 'image' && cfg.bgImage ? (
        <>
          <Image source={{ uri: cfg.bgImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        </>
      ) : null}
      {children}
    </View>
  );
  const pill = (label, onPress, icon, flex) => (
    <TouchableOpacity style={[s.pill, flex && { flex: 1, marginHorizontal: 4 }]} onPress={onPress}>
      {icon ? <Ionicons name={icon} size={20} color="#fff" style={{ marginRight: label ? 8 : 0 }} /> : null}
      {label ? <Text style={s.pillT}>{label}</Text> : null}
    </TouchableOpacity>
  );
  const row = (t, onPress, right) => (
    <TouchableOpacity style={[s.row, { borderColor: cfg.border }]} onPress={onPress}>
      <Cover uri={covers[t.id]} size={56} bc={cfg.border} />
      <Text style={[s.rowText, cur && cur.id === t.id && { color: G }]} numberOfLines={1}>{nome(t)}</Text>
      <View style={{ width: 56, alignItems: 'center' }}>{right}</View>
    </TouchableOpacity>
  );

  if (status === 'loading') return screen(
    <View style={s.center}><ActivityIndicator size="large" color={G} /><Text style={s.sub}>Procurando suas músicas...</Text></View>);
  if (status === 'denied') return screen(
    <View style={s.center}>
      <Text style={s.title}>Preciso de permissão</Text>
      <Text style={s.sub}>Libere o acesso a músicas e áudio para o app encontrar suas faixas.</Text>
      {pill('Abrir configurações', () => Linking.openSettings())}
      <View style={{ height: 10 }} />
      {pill('Tentar de novo', init)}
    </View>);

  if (recap) {
    const [y, mo] = recap.key.split('-');
    const m = stats.current[recap.key] || { ms: 0, t: {} };
    const top = Object.values(m.t).sort((a, b) => b.ms - a.ms).slice(0, 5);
    const mins = (ms) => (ms < 60000 ? '<1' : String(Math.round(ms / 60000)));
    return screen(
      <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
        <Text style={s.sub}>Seu resumo de</Text>
        <Text style={s.recapMes}>{MESES[Number(mo) - 1]} de {y}</Text>
        <Text style={s.recapNum}>{Math.round(m.ms / 60000)}</Text>
        <Text style={s.title}>minutos ouvidos</Text>
        <Text style={[s.head, { marginTop: 36 }]}>Músicas mais ouvidas</Text>
        {top.length === 0 ? <Text style={s.sub}>Ainda sem dados.</Text> : top.map((t, i) => (
          <View key={i} style={[s.row, { borderColor: cfg.border, width: '100%' }]}>
            <Text style={s.rank}>{i + 1}</Text>
            <Text style={s.rowText} numberOfLines={1}>{t.n}</Text>
            <Text style={s.time}>{mins(t.ms)} min</Text>
          </View>))}
        <View style={{ height: 24 }} />
        {pill('Fechar', closeRecap, 'close')}
      </ScrollView>);
  }

  if (view === 'settings') return screen(
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.setHead}>
        <TouchableOpacity style={s.round} onPress={() => setView('songs')}><Ionicons name="chevron-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={s.head}>Configurações</Text>
        <View style={{ width: 44 }} />
      </View>
      <View style={s.card}>
        <View style={s.switchRow}>
          <Text style={s.cardT}>Ícones nas barras do topo</Text>
          <Switch value={cfg.tabIcons} onValueChange={(v) => patch({ tabIcons: v })} trackColor={{ true: G }} />
        </View>
      </View>
      <View style={s.card}>
        <Text style={s.cardT}>Cor das bordas das músicas</Text>
        <View style={s.dots}>
          {BORDERS.map((c) => (
            <TouchableOpacity key={c} style={[s.dot, { backgroundColor: c }]} onPress={() => patch({ border: c })}>
              {cfg.border === c ? <Ionicons name="checkmark" size={22} color={c === '#ffffff' ? '#000' : '#fff'} /> : null}
            </TouchableOpacity>))}
        </View>
      </View>
      <View style={s.card}>
        <Text style={s.cardT}>Fundo da página inicial</Text>
        <View style={s.dots}>
          {THEMES.map((t) => (
            <TouchableOpacity key={t.id} style={s.themeBox} onPress={() => patch({ bgType: 'theme', theme: t.id })}>
              <View style={[s.dot, { backgroundColor: t.c, borderWidth: 2, borderColor: cfg.bgType === 'theme' && cfg.theme === t.id ? G : '#555' }]}>
                {cfg.bgType === 'theme' && cfg.theme === t.id ? <Ionicons name="checkmark" size={22} color="#fff" /> : null}
              </View>
              <Text style={s.small}>{t.n}</Text>
            </TouchableOpacity>))}
        </View>
        <View style={{ marginTop: 14 }}>{pill('Escolher imagem do celular', pickBg, 'image')}</View>
        {cfg.bgType === 'image' ? <View style={{ marginTop: 10 }}>{pill('Remover imagem', () => patch({ bgType: 'theme' }), 'trash')}</View> : null}
      </View>
      <View style={s.card}>
        <Text style={s.cardT}>Resumo do mês</Text>
        <Text style={s.small}>Aparece sozinho na primeira vez que você abre o app em cada mês.</Text>
        <View style={{ marginTop: 12 }}>{pill('Ver prévia do mês atual', () => setRecap({ key: mkey(new Date()), auto: false }), 'stats-chart')}</View>
      </View>
    </ScrollView>);

  if (showPlayer && cur) return screen(
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={s.back} onPress={() => setShowPlayer(false)}><Ionicons name="chevron-down" size={34} color="#fff" /></TouchableOpacity>
      <View style={{ alignItems: 'center', marginTop: 4 }}><Cover uri={covers[cur.id]} size={W * 0.82} bc={cfg.border} /></View>
      <Text style={s.big} numberOfLines={2}>{nome(cur)}</Text>
      <View style={{ alignSelf: 'center' }}>{pill(covers[cur.id] ? 'Trocar foto' : 'Adicionar foto', () => pickCover(cur), 'camera')}</View>
      <TouchableOpacity activeOpacity={1} style={s.barBox} onLayout={(e) => { barW.current = e.nativeEvent.layout.width; }}
        onPress={(e) => sound.current && dur && sound.current.setPositionAsync((e.nativeEvent.locationX / barW.current) * dur)}>
        <View style={s.bar}><View style={[s.fill, { width: dur ? `${(pos / dur) * 100}%` : '0%' }]} /></View>
      </TouchableOpacity>
      <View style={s.timeRow}><Text style={s.time}>{fmt(pos)}</Text><Text style={s.time}>{fmt(dur)}</Text></View>
      <View style={s.controls}>
        <TouchableOpacity onPress={() => setShuffle(!shuffle)}><Ionicons name="shuffle" size={30} color={shuffle ? G : '#777'} /></TouchableOpacity>
        <TouchableOpacity onPress={prev}><Ionicons name="play-skip-back" size={36} color="#fff" /></TouchableOpacity>
        <TouchableOpacity style={s.play} onPress={toggle}><Ionicons name={playing ? 'pause' : 'play'} size={38} color="#000" /></TouchableOpacity>
        <TouchableOpacity onPress={() => step(1, false)}><Ionicons name="play-skip-forward" size={36} color="#fff" /></TouchableOpacity>
        <TouchableOpacity onPress={() => setLoop(loop === 'off' ? 'all' : loop === 'all' ? 'one' : 'off')}>
          <MaterialCommunityIcons name={loop === 'one' ? 'repeat-once' : 'repeat'} size={30} color={loop === 'off' ? '#777' : G} />
        </TouchableOpacity>
      </View>
    </View>);

  const pl = playlists.find((p) => p.id === openPl);
  const plTracks = pl ? pl.ids.map((id) => tracks.find((t) => t.id === id)).filter(Boolean) : [];
  const open = (list, i) => { play(list, i); setShowPlayer(true); };
  const tab = (v, icon, label, on) => (
    <TouchableOpacity style={[s.tab, on && { backgroundColor: G }]} onPress={() => setView(v)}>
      {cfg.tabIcons ? <Ionicons name={icon} size={20} color="#fff" style={{ marginRight: 8 }} /> : null}
      <Text style={s.pillT}>{label}</Text>
    </TouchableOpacity>
  );

  return screen(
    <View style={{ flex: 1 }}>
      <View style={s.tabs}>
        {tab('songs', 'musical-notes', 'Músicas', view === 'songs')}
        {tab('playlists', 'albums', 'Playlists', view !== 'songs')}
        <TouchableOpacity style={s.round} onPress={() => setView('settings')}><Ionicons name="settings-sharp" size={22} color="#fff" /></TouchableOpacity>
      </View>

      {view === 'songs' && (
        <FlatList data={tracks} keyExtractor={(t) => t.id}
          ListEmptyComponent={<Text style={s.sub}>Nenhuma música encontrada.</Text>}
          renderItem={({ item, index }) => row(item, () => open(tracks, index), <Text style={s.time}>{fmt(item.duration * 1000)}</Text>)} />
      )}

      {view === 'playlists' && (
        <View style={{ flex: 1 }}>
          <View style={s.newRow}>
            <TextInput style={s.input} placeholder="Nome da nova playlist" placeholderTextColor="#888" value={newName} onChangeText={setNewName} />
            <TouchableOpacity style={s.add} onPress={createPl}><Ionicons name="add" size={28} color="#000" /></TouchableOpacity>
          </View>
          <FlatList data={playlists} keyExtractor={(p) => p.id}
            ListEmptyComponent={<Text style={s.sub}>Nenhuma playlist ainda. Crie uma acima.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={[s.row, { borderColor: cfg.border }]} onPress={() => { setOpenPl(item.id); setEditing(false); setView('detail'); }}>
                <View style={[s.folder, { borderColor: cfg.border }]}><Ionicons name="albums" size={26} color="#ccc" /></View>
                <Text style={s.rowText} numberOfLines={1}>{item.name}</Text>
                <View style={{ width: 56, alignItems: 'center' }}><Text style={s.time}>{item.ids.length}</Text></View>
              </TouchableOpacity>
            )} />
        </View>
      )}

      {view === 'detail' && pl && (
        <View style={{ flex: 1 }}>
          <Text style={s.head}>{pl.name}</Text>
          <View style={s.newRow}>
            {pill('Tocar', () => plTracks.length && open(plTracks, 0), 'play', true)}
            {pill(editing ? 'Concluir' : 'Editar', () => setEditing(!editing), editing ? 'checkmark' : 'create', true)}
            {pill('', () => delPl(pl), 'trash', false)}
          </View>
          {editing ? (
            <FlatList data={tracks} keyExtractor={(t) => t.id}
              renderItem={({ item }) => row(item, () => togglePl(pl.id, item.id), pl.ids.includes(item.id) ? <Ionicons name="checkmark-circle" size={28} color={G} /> : <Ionicons name="ellipse-outline" size={28} color="#777" />)} />
          ) : (
            <FlatList data={plTracks} keyExtractor={(t) => t.id}
              ListEmptyComponent={<Text style={s.sub}>Playlist vazia. Toque em Editar para adicionar músicas.</Text>}
              renderItem={({ item, index }) => row(item, () => open(plTracks, index), null)} />
          )}
        </View>
      )}

      {cur && (
        <TouchableOpacity style={[s.mini, { borderColor: cfg.border }]} onPress={() => setShowPlayer(true)}>
          <Cover uri={covers[cur.id]} size={48} bc={cfg.border} />
          <Text style={[s.rowText, { color: '#fff' }]} numberOfLines={1}>{nome(cur)}</Text>
          <TouchableOpacity style={s.miniBtn} onPress={toggle}><Ionicons name={playing ? 'pause' : 'play'} size={24} color="#000" /></TouchableOpacity>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, paddingTop: StatusBar.currentHeight || 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sub: { color: '#bbb', fontSize: 16, textAlign: 'center', margin: 24 },
  head: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', paddingBottom: 12 },
  small: { color: '#aaa', fontSize: 13, textAlign: 'center', marginTop: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', paddingVertical: 13, paddingHorizontal: 22, borderRadius: 30 },
  pillT: { color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  tabs: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  tab: { flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 4 },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  newRow: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 10, alignItems: 'center' },
  input: { flex: 1, height: 52, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 30, paddingHorizontal: 20, marginRight: 8, fontSize: 16, textAlign: 'center' },
  add: { backgroundColor: G, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 2, borderRadius: 28, marginHorizontal: 14, marginVertical: 6, padding: 10 },
  rowText: { color: '#eee', fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  folder: { width: 56, height: 56, borderRadius: 19, borderWidth: 2, backgroundColor: '#2b2b2b', alignItems: 'center', justifyContent: 'center' },
  rank: { color: G, fontSize: 22, fontWeight: '800', width: 40, textAlign: 'center' },
  time: { color: '#999', fontSize: 13, textAlign: 'center' },
  mini: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(30,30,30,0.95)', borderWidth: 2, borderRadius: 32, margin: 12, padding: 8 },
  miniBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: G, alignItems: 'center', justifyContent: 'center' },
  back: { alignItems: 'center', paddingVertical: 4 },
  big: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', margin: 18, marginBottom: 12 },
  barBox: { paddingVertical: 16, paddingHorizontal: 28 },
  bar: { height: 8, backgroundColor: '#444', borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: G },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 28 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 20, paddingHorizontal: 12 },
  play: { backgroundColor: G, width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  setHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  card: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 28, marginHorizontal: 14, marginVertical: 7, padding: 18 },
  cardT: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 },
  dot: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', margin: 6 },
  themeBox: { alignItems: 'center', margin: 2 },
  recapMes: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', textTransform: 'capitalize' },
  recapNum: { color: G, fontSize: 96, fontWeight: '900', textAlign: 'center', marginTop: 20 },
});
