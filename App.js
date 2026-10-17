import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, AppState,
  StatusBar, Linking, I18nManager, BackHandler,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, {
  AndroidImportance, AndroidCategory, AndroidVisibility, TriggerType, EventType,
  AndroidNotificationSetting,
} from '@notifee/react-native';
import * as Speech from 'expo-speech';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';

// ---------- constants ----------
const CHANNEL = 'rescue-calls-v1';
const NID = 'rescue-call';
const STORE = 'std-settings-v1';
const REC_PATH = FileSystem.documentDirectory + 'recording';

const CALLERS = ['אבא', 'אמא', 'הבוס', 'מפקד מילואים', 'אחותי'];
const DELAYS = [[5, '5 שנ׳'], [30, '30 שנ׳'], [120, '2 דק׳'], [300, '5 דק׳'], [600, '10 דק׳']];
const SCENARIOS = {
  work: { label: 'משבר בעבודה',
    m: 'הלו? היי, תקשיב, יש פה תקלה רצינית אצל לקוח, השרתים נפלו ורק אתה יודע לטפל בזה. אתה חייב להגיע מייד, אני מחכה לך.',
    f: 'הלו? היי, תקשיבי, יש פה תקלה רצינית אצל לקוח, השרתים נפלו ורק את יודעת לטפל בזה. את חייבת להגיע מייד, אני מחכה לך.' },
  army: { label: 'הקפצה דחופה',
    m: 'הלו? שלום, זה דחוף. יש הקפצה, אתה צריך להתייצב ביחידה תוך שעה. תתארגן וצא עכשיו, נדבר בדרך.',
    f: 'הלו? שלום, זה דחוף. יש הקפצה, את צריכה להתייצב ביחידה תוך שעה. תתארגני וצאי עכשיו, נדבר בדרך.' },
  home: { label: 'חירום בבית',
    m: 'הלו? היי, אל תיבהל, אבל התפוצץ צינור בבית ויש מים בכל הסלון. אי אפשר לסגור את הברז הראשי, אתה חייב לבוא עכשיו.',
    f: 'הלו? היי, אל תיבהלי, אבל התפוצץ צינור בבית ויש מים בכל הסלון. אי אפשר לסגור את הברז הראשי, את חייבת לבוא עכשיו.' },
  keys: { label: 'נתקעו בלי מפתח',
    m: 'הלו? היי, נתקענו מחוץ לבית בלי מפתחות והילדים בחוץ בקור. אתה יכול לבוא עם המפתח? זה ממש דחוף.',
    f: 'הלו? היי, נתקענו מחוץ לבית בלי מפתחות והילדים בחוץ בקור. את יכולה לבוא עם המפתח? זה ממש דחוף.' },
  dog: { label: 'הכלב ברח',
    m: 'הלו? היי, הכלב ברח מהחצר ואין אותו בשום מקום. צריך אותך פה עכשיו לעזור לחפש.',
    f: 'הלו? היי, הכלב ברח מהחצר ואין אותו בשום מקום. צריך אותך פה עכשיו לעזור לחפש.' },
};

// RTL helpers that work whether or not the phone itself is in an RTL language
const RIGHT = I18nManager.isRTL ? 'left' : 'right';
const ROW = I18nManager.isRTL ? 'row' : 'row-reverse';

const C = {
  bg: '#0f1115', panel: '#181b22', line: '#2a2f3a', fg: '#eef0f4', muted: '#8b93a3',
  accent: '#e8b04a', ink: '#1a1405', answer: '#22c55e', decline: '#ef4444', ok: '#4ade80', warn: '#fbbf24',
};

// ---------- notifications ----------
async function ensureChannel() {
  await notifee.createChannel({
    id: CHANNEL,
    name: 'שיחות חילוץ',
    importance: AndroidImportance.HIGH,
    sound: 'ringtone',
    vibration: true,
    vibrationPattern: [1000, 500, 1000, 500],
    visibility: AndroidVisibility.PUBLIC,
  });
}

async function scheduleCall(name, delaySec) {
  await ensureChannel();
  await notifee.createTriggerNotification(
    {
      id: NID,
      title: name,
      body: 'שיחה נכנסת',
      android: {
        channelId: CHANNEL,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        fullScreenAction: { id: 'default' },
        pressAction: { id: 'default' },
        loopSound: true,
        ongoing: true,
        autoCancel: false,
        sound: 'ringtone',
        vibrationPattern: [1000, 500, 1000, 500],
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: Date.now() + delaySec * 1000,
      alarmManager: { allowWhileIdle: true },
    }
  );
}

async function stopCallNotification() {
  try { await notifee.cancelTriggerNotification(NID); } catch (e) {}
  try { await notifee.cancelNotification(NID); } catch (e) {}
}

async function isRinging() {
  try {
    const shown = await notifee.getDisplayedNotifications();
    return shown.some((n) => n.id === NID || n.notification?.id === NID);
  } catch (e) { return false; }
}

// ---------- app ----------
export default function App() {
  const [screen, setScreen] = useState('setup'); // setup | armed | incoming | active
  const [name, setName] = useState('הבוס');
  const [scenario, setScenario] = useState('work');
  const [gender, setGender] = useState('m');
  const [text, setText] = useState(SCENARIOS.work.m);
  const [delay, setDelay] = useState(30);
  const [hasRec, setHasRec] = useState(false);
  const [recName, setRecName] = useState('');
  const [status, setStatus] = useState(null); // {msg, kind}
  const [perm, setPerm] = useState({ notif: true, alarm: true });
  const [seconds, setSeconds] = useState(1);
  const soundRef = useRef(null);
  const timers = useRef([]);
  const loaded = useRef(false);

  // load saved settings
  useEffect(() => {
    (async () => {
      try {
        const s = JSON.parse((await AsyncStorage.getItem(STORE)) || '{}');
        if (s.name) setName(s.name);
        if (s.scenario) setScenario(s.scenario);
        if (s.gender) setGender(s.gender);
        if (s.text) setText(s.text);
        if (s.delay) setDelay(s.delay);
        if (s.recName) setRecName(s.recName);
      } catch (e) {}
      try { setHasRec((await FileSystem.getInfoAsync(REC_PATH)).exists); } catch (e) {}
      loaded.current = true;
      await checkPermissions();
      if (await isRinging()) setScreen('incoming');
    })();
    Audio.setAudioModeAsync({ shouldDuckAndroid: false, playThroughEarpieceAndroid: false }).catch(() => {});
  }, []);

  // save settings on change
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORE, JSON.stringify({ name, scenario, gender, text, delay, recName })).catch(() => {});
  }, [name, scenario, gender, text, delay, recName]);

  // the call can arrive while the app is open, or open the app from the lock screen
  useEffect(() => {
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      if (detail.notification?.id !== NID) return;
      if (type === EventType.DELIVERED || type === EventType.PRESS) setScreen('incoming');
    });
    const sub = AppState.addEventListener('change', async (st) => {
      if (st === 'active') {
        await checkPermissions();
        if (await isRinging()) setScreen((s) => (s === 'active' ? s : 'incoming'));
      }
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => screen !== 'setup');
    return () => { unsub(); sub.remove(); back.remove(); };
  }, [screen]);

  async function checkPermissions() {
    try {
      const s = await notifee.getNotificationSettings();
      setPerm({
        notif: s.authorizationStatus >= 1,
        alarm: s.android?.alarm !== AndroidNotificationSetting.DISABLED,
      });
    } catch (e) {}
  }

  const clearTimers = () => { timers.current.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers.current = []; };

  const stopVoice = useCallback(async () => {
    try { Speech.stop(); } catch (e) {}
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch (e) {}
      soundRef.current = null;
    }
  }, []);

  async function speakOrPlay() {
    if (hasRec) {
      try {
        const { sound } = await Audio.Sound.createAsync({ uri: REC_PATH }, { shouldPlay: true, volume: 1 });
        soundRef.current = sound;
        return;
      } catch (e) {}
    }
    Speech.speak(text.trim() || 'הלו?', { language: 'he-IL', rate: 1.0 });
  }

  // ----- actions -----
  async function start() {
    const p = await notifee.requestPermission();
    await checkPermissions();
    if (p.authorizationStatus < 1) {
      setStatus({ msg: 'בלי הרשאת התראות הטלפון לא יוכל לצלצל. אשר התראות בהגדרות ונסה שוב.', kind: 'warn' });
      return;
    }
    await stopCallNotification();
    await scheduleCall(name.trim() || 'מספר לא מזוהה', delay);
    setStatus(null);
    setScreen('armed');
  }

  async function reset() {
    clearTimers();
    await stopCallNotification();
    await stopVoice();
    setScreen('setup');
  }

  async function answer() {
    await stopCallNotification();
    setSeconds(1);
    setScreen('active');
    timers.current.push(setInterval(() => setSeconds((s) => s + 1), 1000));
    timers.current.push(setTimeout(speakOrPlay, 1500));
  }

  function pickScenario(k) { setScenario(k); setText(SCENARIOS[k][gender]); }
  function pickGender(g) { setGender(g); setText(SCENARIOS[scenario][g]); }

  async function pickRecording() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    try {
      await FileSystem.deleteAsync(REC_PATH, { idempotent: true });
      await FileSystem.copyAsync({ from: a.uri, to: REC_PATH });
      setHasRec(true); setRecName(a.name || 'הקלטה');
      setStatus({ msg: '✓ ההקלטה נשמרה ותושמע בשיחה במקום הטקסט.', kind: 'ok' });
    } catch (e) {
      setStatus({ msg: 'לא הצלחתי לשמור את ההקלטה. נסה קובץ אחר.', kind: 'warn' });
    }
  }
  async function removeRecording() {
    await FileSystem.deleteAsync(REC_PATH, { idempotent: true }).catch(() => {});
    setHasRec(false); setRecName('');
  }
  async function testVoice() {
    await stopVoice();
    if (hasRec) { speakOrPlay(); setStatus({ msg: 'מנגן את ההקלטה.', kind: 'ok' }); return; }
    const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
    const he = voices.some((v) => /^(he|iw)/i.test(v.language));
    Speech.speak('הלו? בדיקה, שומעים אותי?', { language: 'he-IL' });
    setStatus(he
      ? { msg: '✓ נמצא קול עברי בטלפון.', kind: 'ok' }
      : { msg: 'לא נמצא קול עברי. התקן "Speech Services by Google" מחנות Play, או העלה הקלטה.', kind: 'warn' });
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const shownName = name.trim() || 'מספר לא מזוהה';

  // ----- screens -----
  if (screen === 'armed') {
    return (
      <Pressable style={{ flex: 1, backgroundColor: '#000' }} delayLongPress={2000} onLongPress={reset}>
        <StatusBar hidden />
      </Pressable>
    );
  }

  if (screen === 'incoming') {
    return (
      <View style={s.call}>
        <StatusBar hidden />
        <Text style={s.callStatus}>שיחה נכנסת · נייד</Text>
        <View style={s.avatar}><Text style={s.avatarTxt}>{shownName.charAt(0)}</Text></View>
        <Text style={s.who}>{shownName}</Text>
        <Text style={s.sub}>+972 5•-•••-••••</Text>
        <View style={{ flex: 1 }} />
        <View style={s.actions}>
          <View style={s.act}>
            <Pressable style={[s.round, { backgroundColor: C.decline }]} onPress={reset}>
              <Text style={[s.phone, { transform: [{ rotate: '135deg' }] }]}>✆</Text>
            </Pressable>
            <Text style={s.actLbl}>דחה</Text>
          </View>
          <View style={s.act}>
            <Pressable style={[s.round, { backgroundColor: C.answer }]} onPress={answer}>
              <Text style={s.phone}>✆</Text>
            </Pressable>
            <Text style={s.actLbl}>ענה</Text>
          </View>
        </View>
      </View>
    );
  }

  if (screen === 'active') {
    const tools = ['השתק', 'מקלדת', 'רמקול', 'הוסף שיחה', 'המתנה', 'אנשי קשר'];
    return (
      <View style={s.call}>
        <StatusBar hidden />
        <View style={[s.avatar, { marginTop: 8 }]}><Text style={s.avatarTxt}>{shownName.charAt(0)}</Text></View>
        <Text style={s.who}>{shownName}</Text>
        <Text style={s.sub}>{mmss}</Text>
        <View style={{ flex: 1 }} />
        <View style={s.grid}>
          {tools.map((t) => (
            <View key={t} style={s.tool}><View style={s.toolDot} /><Text style={s.toolLbl}>{t}</Text></View>
          ))}
        </View>
        <Pressable style={[s.round, { backgroundColor: C.decline }]} onPress={reset}>
          <Text style={[s.phone, { transform: [{ rotate: '135deg' }] }]}>✆</Text>
        </Pressable>
      </View>
    );
  }

  // setup
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Save the <Text style={{ color: C.accent }}>Date</Text></Text>
        <Text style={s.lead}>בוחרים מי מתקשר ומה הוא אומר. הטלפון יצלצל בזמן שקבעת, גם כשהוא נעול.</Text>

        {(!perm.notif || !perm.alarm) && (
          <View style={[s.box, { borderColor: C.warn }]}>
            <Text style={[s.small, { color: C.warn }]}>
              {!perm.notif ? 'צריך לאשר התראות כדי שהטלפון יצלצל.' : 'צריך לאשר "התראות ותזכורות" כדי שהצלצול יגיע בזמן.'}
            </Text>
            <Pressable style={s.btn} onPress={() => (!perm.notif ? notifee.openNotificationSettings() : notifee.openAlarmPermissionSettings())}>
              <Text style={s.btnTxt}>פתח הגדרות</Text>
            </Pressable>
          </View>
        )}

        <Text style={s.label}>שם המתקשר</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} maxLength={28} placeholderTextColor={C.muted} placeholder="למשל: רונית מהמשרד" />
        <Chips items={CALLERS.map((c) => [c, c])} value={name.trim()} onPick={setName} />

        <Text style={s.label}>תבנית תירוץ</Text>
        <Chips items={Object.entries(SCENARIOS).map(([k, v]) => [k, v.label])} value={scenario} onPick={pickScenario} />
        <Chips items={[['m', 'פונה לגבר'], ['f', 'פונה לאישה']]} value={gender} onPick={pickGender} />

        <Text style={s.label}>מה יגידו בשיחה (עריכה חופשית)</Text>
        <TextInput style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} value={text} onChangeText={setText} multiline />

        <View style={s.box}>
          <Text style={s.boxTitle}>הקול בשיחה</Text>
          <Text style={s.small}>
            {hasRec ? `✓ תושמע ההקלטה: ${recName}` : 'בלי הקלטה הטלפון יקריא את הטקסט בקול ממוחשב. הקלטה אמיתית של חבר משכנעת הרבה יותר.'}
          </Text>
          <View style={[s.row, { gap: 8 }]}>
            <Pressable style={s.btn} onPress={pickRecording}><Text style={s.btnTxt}>{hasRec ? 'החלף הקלטה' : 'העלה הקלטה'}</Text></Pressable>
            <Pressable style={s.btn} onPress={testVoice}><Text style={s.btnTxt}>בדיקת קול</Text></Pressable>
            {hasRec && <Pressable style={s.btn} onPress={removeRecording}><Text style={[s.btnTxt, { color: '#fca5a5' }]}>הסר</Text></Pressable>}
          </View>
        </View>

        <Text style={s.label}>הטלפון יצלצל בעוד</Text>
        <Chips items={DELAYS.map(([v, l]) => [v, l])} value={delay} onPick={setDelay} />

        {status && <Text style={[s.small, { color: status.kind === 'ok' ? C.ok : C.warn }]}>{status.msg}</Text>}

        <Pressable style={s.go} onPress={start}><Text style={s.goTxt}>הפעל חילוץ</Text></Pressable>
        <Text style={s.note}>
          אחרי הלחיצה המסך יוחשך. אפשר לנעול את הטלפון ולהכניס לכיס, השיחה תגיע בזמן. לביטול: פותחים את האפליקציה ולוחצים לחיצה ארוכה של 2 שניות על המסך השחור.
        </Text>
        <Pressable onPress={() => Linking.openSettings()}>
          <Text style={[s.note, { textDecorationLine: 'underline' }]}>
            השיחה לא קופצת על מסך מלא כשהטלפון נעול? בהגדרות האפליקציה אשר "התראות במסך מלא".
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Chips({ items, value, onPick }) {
  return (
    <View style={s.chips}>
      {items.map(([k, label]) => {
        const on = k === value;
        return (
          <Pressable key={String(k)} onPress={() => onPick(k)} style={[s.chip, on && s.chipOn]}>
            <Text style={[s.chipTxt, on && { color: C.ink, fontWeight: '700' }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingTop: 44, gap: 12, paddingBottom: 40 },
  h1: { color: C.fg, fontSize: 30, fontWeight: '700', textAlign: RIGHT },
  lead: { color: C.muted, fontSize: 15, lineHeight: 22, textAlign: RIGHT, marginBottom: 6 },
  label: { color: C.muted, fontSize: 12, letterSpacing: 1, marginTop: 10, textAlign: RIGHT },
  input: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.fg, fontSize: 16, padding: 12, textAlign: RIGHT, writingDirection: 'rtl' },
  chips: { flexDirection: ROW, flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipTxt: { color: C.fg, fontSize: 14 },
  box: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, marginTop: 10 },
  boxTitle: { color: C.fg, fontSize: 15, fontWeight: '700', textAlign: RIGHT },
  small: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: RIGHT },
  row: { flexDirection: ROW, flexWrap: 'wrap' },
  btn: { borderColor: C.line, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  btnTxt: { color: C.fg, fontSize: 14 },
  go: { backgroundColor: C.accent, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 14 },
  goTxt: { color: C.ink, fontSize: 20, fontWeight: '700' },
  note: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: RIGHT },

  call: { flex: 1, backgroundColor: '#0b0d11', alignItems: 'center', paddingTop: 64, paddingBottom: 56, paddingHorizontal: 16 },
  callStatus: { color: '#b8c0cc', fontSize: 15 },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#3b5b8c', alignItems: 'center', justifyContent: 'center', marginTop: 40 },
  avatarTxt: { color: '#fff', fontSize: 52 },
  who: { color: '#fff', fontSize: 36, marginTop: 14, marginBottom: 6, textAlign: 'center' },
  sub: { color: '#9aa3b2', fontSize: 15, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', maxWidth: 320 },
  act: { alignItems: 'center', gap: 10 },
  actLbl: { color: '#cbd2dc', fontSize: 13 },
  round: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  phone: { color: '#fff', fontSize: 34 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 300, justifyContent: 'space-between', rowGap: 22, marginBottom: 44 },
  tool: { width: 90, alignItems: 'center', gap: 8 },
  toolDot: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.08)' },
  toolLbl: { color: '#aeb6c2', fontSize: 12 },
});
