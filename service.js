const TrackPlayer = require('react-native-track-player').default;
const { Event, State } = require('react-native-track-player');
const AsyncStorage = require('@react-native-async-storage/async-storage').default;

const mkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
let stats = null;
let last = { id: null, pos: 0 };
let n = 0;

async function load() {
  if (stats) return;
  try { const r = await AsyncStorage.getItem('stats'); stats = r ? JSON.parse(r) : {}; } catch (e) { stats = {}; }
}
const save = () => (stats ? AsyncStorage.setItem('stats', JSON.stringify(stats)).catch(() => {}) : null);

module.exports = async function () {
  const P = TrackPlayer;
  P.addEventListener(Event.RemotePlay, () => P.play());
  P.addEventListener(Event.RemotePause, () => { P.pause(); save(); });
  P.addEventListener(Event.RemoteNext, () => P.skipToNext().catch(() => {}));
  P.addEventListener(Event.RemotePrevious, () => P.skipToPrevious().catch(() => {}));
  P.addEventListener(Event.RemoteSeek, (e) => P.seekTo(e.position));
  P.addEventListener(Event.RemoteStop, async () => { await save(); P.reset(); });
  P.addEventListener(Event.PlaybackActiveTrackChanged, () => { last = { id: null, pos: 0 }; save(); });
  P.addEventListener(Event.PlaybackState, (e) => {
    if (e.state === State.Paused || e.state === State.Stopped || e.state === State.Ended) save();
  });
  // registra o tempo ouvido a cada atualização de progresso, mesmo com o app fechado
  P.addEventListener(Event.PlaybackProgressUpdated, async (e) => {
    await load();
    const t = await P.getActiveTrack();
    if (!t) return;
    const d = last.id === t.id ? e.position - last.pos : 0;
    last = { id: t.id, pos: e.position };
    if (d > 0 && d < 5) {
      const k = mkey(new Date());
      const m = stats[k] || (stats[k] = { ms: 0, t: {} });
      m.ms += d * 1000;
      const x = m.t[t.id] || (m.t[t.id] = { n: t.title, ms: 0 });
      x.ms += d * 1000;
      if (++n % 3 === 0) save();
    }
  });
};
