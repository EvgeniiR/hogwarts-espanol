// ── AUDIO ──────────────────────────────────────────────────────────────────
// Ambient music with reliable mute/unmute and autoplay.
// - Loads playlist from manifest.json (fallback hardcoded)
// - Shuffles on first load
// - Respects S.musicOff (persisted)
// - Starts on first user interaction (pointer/key)
// - Mute/Unmute toggle pauses/resumes the current track without reloading.

import { S, saveS } from './state.js';
import { shuffleArray } from './helpers.js';

// ── Fallback list ──────────────────────────────────────────────────────────
const FALLBACK_FILES = [
  "audio/A Fool's Theme - Brian Bolger.mp3",
  "audio/Aaron Kenny - English Country Garden (Happy).mp3",
  "audio/Aaron Kenny - Happy Haunts (Happy).mp3",
  "audio/Aaron Kenny - The Curious Kitten (Bright).mp3",
  "audio/Cooper Cannell - Sprightly Pursuit (Bright).mp3",
  "audio/English Country Garden - Aaron Kenny.mp3",
  "audio/First Dream - Brian Bolger.mp3",
  "audio/Jesse's Carnival Waltz - The Great North Sound Society.mp3",
  "audio/Saving The World - Aaron Kenny.mp3",
  "audio/Sir Cubworth - Monster At The Door (Dark).mp3",
  "audio/Sir Cubworth - Murder Mystery (Dramatic).mp3",
  "audio/Sir Cubworth - Rolling Hills (Inspirational).mp3",
  "audio/Sir Cubworth - Waltz To Death (Dark).mp3",
  "audio/The Curious Kitten - Aaron Kenny.mp3",
  "audio/The Two Seasons - Dan Bodan.mp3",
];

let actx = null;
let _playlist = [];
let _index = -1;
let _audio = null;
let _playing = false;
let _ready = false;
let _listenerAttached = false;
let _starting = false;
let _stopRequested = false;

function updateButtonUI(off) {
  const btn = document.getElementById('aBtn');
  if (btn) btn.innerHTML = off ? '<i class="ti ti-volume-off"></i>' : '<i class="ti ti-volume"></i>';
}

function resumeContext() {
  if (!actx) return Promise.resolve();
  if (actx.state === 'suspended') return actx.resume();
  return Promise.resolve();
}

async function loadPlaylist() {
  if (_playlist.length) return;
  let files = [];
  try {
    const res = await fetch('audio/manifest.json');
    if (res.ok) {
      const names = await res.json();
      if (Array.isArray(names) && names.length) {
        files = names.map(n => 'audio/' + n);
      }
    }
  } catch (_) { /* ignore */ }
  if (!files.length) files = FALLBACK_FILES;
  _playlist = shuffleArray(files);
  _index = 0;
  _ready = true;
}

function playTrack() {
  if (S.musicOff) {
    stopPlayback();
    return;
  }
  if (!_ready || _playlist.length === 0) return;
  if (_starting) return;

  if (_audio) {
    _audio.pause();
    _audio = null;
  }
  _playing = false;
  _starting = true;
  _stopRequested = false;

  const src = _playlist[_index];
  const audio = new Audio(src);
  audio.volume = 0.25;

  audio.onended = () => {
    if (_playing && !_stopRequested) {
      _index = (_index + 1) % _playlist.length;
      _starting = false;
      playTrack();
    }
  };

  audio.play()
      .then(() => {
        _starting = false;
        if (_stopRequested) {
          audio.pause();
          _audio = null;
          _playing = false;
          updateButtonUI(true);
          return;
        }
        _audio = audio;
        _playing = true;
        updateButtonUI(false);
      })
      .catch(() => {
        _starting = false;
        _playing = false;
      });
}

function stopPlayback() {
  _stopRequested = true;
  _starting = false;
  if (_audio) {
    _audio.pause();
    _audio = null;
  }
  _playing = false;
  updateButtonUI(true);
}

async function ensurePlayback() {
  if (S.musicOff) {
    if (_playing) stopPlayback();
    return;
  }
  if (_playing) return;

  if (!_ready) {
    await loadPlaylist();
    if (_playlist.length === 0) return;
  }

  await resumeContext();

  if (!_playing && !_starting) {
    playTrack();
  }
}

function attachGlobalListener() {
  if (_listenerAttached) return;
  _listenerAttached = true;
  const handler = () => { ensurePlayback().catch(() => {}); };
  document.addEventListener('pointerdown', handler);
  document.addEventListener('keydown', handler);
}

export function tryPlayNow() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  attachGlobalListener();
  ensurePlayback().catch(() => {});
}

export async function tryAudio() {
  if (!_ready) await loadPlaylist();
  attachGlobalListener();
  await ensurePlayback();
}

export function toggleAudio() {
  if (_playing || _audio) {
    stopPlayback();
    S.musicOff = true;
  } else {
    S.musicOff = false;
    ensurePlayback().catch(() => {});
  }
  saveS();
}

export function skipSong() {
  if (!_ready || _playlist.length <= 1) return;
  _index = (_index + 1) % _playlist.length;
  if (_playing) {
    stopPlayback();
    _stopRequested = false;
    _starting = false;
    playTrack();
  } else {
    if (!S.musicOff) {
      ensurePlayback().catch(() => {});
    }
  }
}

export function stopMusic() {
  stopPlayback();
}

export function syncAudioBtn() {
  updateButtonUI(S.musicOff);
}

// ── UI Beeps ──────────────────────────────────────────────────────────────
function beep(freq, type, vol, dur, delay = 0) {
  if (!actx) return;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = vol;
  osc.connect(gain);
  gain.connect(actx.destination);
  const startTime = actx.currentTime + delay;
  osc.start(startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
  osc.stop(startTime + dur);
}

export function playSend()     { beep(600, 'triangle', 0.1, 0.15); }
export function playRecv()     { [500,660,820].forEach((f,i) => beep(f, 'sine', 0.08, 0.22, i*0.075)); }
export function playVocab()    { beep(880, 'sine', 0.07, 0.28); }
export function playSpell()    { [400,600,900,1200,1600].forEach((f,i) => beep(f, 'triangle', 0.06, 0.25, i*0.06)); }
export function playCorrect()  { [523,659,784].forEach((f,i) => beep(f, 'sine', 0.08, 0.25, i*0.08)); }
export function playMinor()    { beep(440, 'triangle', 0.08, 0.2); }
export function playIncorrect(){ [400,350,300].forEach((f,i) => beep(f, 'sawtooth', 0.04, 0.3, i*0.12)); }