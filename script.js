// FlowMusic main script

const STORAGE_KEY_TRACKS = "flowmusic_tracks_v1";
const STORAGE_KEY_VOLUME = "flowmusic_volume_v1";
const STORAGE_KEY_RECENTS = "flowmusic_recents_v1";

// Persist audio files safely (localStorage quota is too small for audio)
const DB_NAME = "flowmusic_db_v1";
const DB_STORE = "tracks";
const DB_VERSION = 1;

const audio = document.getElementById("audio");
const playlistEl = document.getElementById("playlist");
const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");

const btnPlay = document.getElementById("btn-play");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnShuffle = document.getElementById("btn-shuffle");
const btnRepeat = document.getElementById("btn-repeat");

const seekBar = document.getElementById("seek-bar");
const volumeBar = document.getElementById("volume-bar");
const currentTimeEl = document.getElementById("current-time");
const totalTimeEl = document.getElementById("total-time");
const trackTitleEl = document.getElementById("track-title");
const trackSubtitleEl = document.getElementById("track-subtitle");
const waveCanvas = document.getElementById("wave-canvas");

// Sections & nav
const homeSection = document.getElementById("home-section");
const searchSection = document.getElementById("search-section");
const mySongsSection = document.getElementById("mysongs-section");
const profileSection = document.getElementById("profile-section");
const navButtons = document.querySelectorAll(".nav-btn");
const recentGrid = document.getElementById("recent-grid");
const recommendGrid = document.getElementById("recommend-grid");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const profileCount = document.getElementById("profile-count");

const canvasCtx = waveCanvas.getContext("2d");

let state = {
  tracks: [],
  currentIndex: 0,
  isPlaying: false,
  isShuffle: false,
  repeatMode: "off", // off | all | one
  currentTab: "home",
  recents: [],
};

let audioCtx = null;
let analyser = null;
let sourceNode = null;
let animationId = null;
let audioGraphReady = false;

// IndexedDB helpers
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutTrack(trackRecord) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB write failed"));
    };
    tx.objectStore(DB_STORE).put(trackRecord);
  });
}

async function idbGetTrack(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB read failed"));
    };
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function hydrateTrackUrlsFromDb() {
  // Create object URLs from stored blobs so <audio> can play them
  for (const t of state.tracks) {
    if (t.url) continue;
    try {
      const rec = await idbGetTrack(t.id);
      if (rec && rec.blob) {
        t.url = URL.createObjectURL(rec.blob);
      }
    } catch (e) {
      console.warn("Could not hydrate track from DB:", e);
    }
  }
}

// Util: time formatting
function formatTime(sec) {
  if (isNaN(sec) || !isFinite(sec)) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// Storage
function saveTracks() {
  try {
    const payload = state.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      // url is recreated from IndexedDB on startup
      duration: t.duration || null,
    }));
    localStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(payload));
  } catch (e) {
    console.warn("Unable to save tracks:", e);
  }
}

function loadTracks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TRACKS);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    state.tracks = parsed.map((t) => ({
      id: t.id,
      name: t.name,
      url: null,
      duration: t.duration,
    }));
  } catch (e) {
    console.warn("Unable to load tracks:", e);
  }
}

function saveRecents() {
  try {
    localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(state.recents));
  } catch (e) {
    console.warn("Unable to save recents:", e);
  }
}

function loadRecents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENTS);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    state.recents = parsed;
  } catch (e) {
    console.warn("Unable to load recents:", e);
  }
}

function saveVolume(vol) {
  try {
    localStorage.setItem(STORAGE_KEY_VOLUME, String(vol));
  } catch {}
}

function loadVolume() {
  const raw = localStorage.getItem(STORAGE_KEY_VOLUME);
  const v = raw !== null ? parseFloat(raw) : 0.8;
  const volume = isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
  audio.volume = volume;
  volumeBar.value = volume;
}

// Rendering playlist
function renderPlaylist() {
  playlistEl.innerHTML = "";
  if (state.tracks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "playlist-item";
    empty.style.opacity = "0.65";
    empty.innerHTML =
      '<span class="title">Your playlist is empty</span><span class="meta"><span class="dot"></span><span>Add songs to begin</span></span>';
    playlistEl.appendChild(empty);
    return;
  }

  state.tracks.forEach((track, index) => {
    const li = document.createElement("li");
    li.className = "playlist-item";
    li.dataset.index = index;

    if (index === state.currentIndex) {
      li.classList.add("active");
    }

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = track.name;

    const meta = document.createElement("span");
    meta.className = "meta";

    const dot = document.createElement("span");
    dot.className = "dot";

    const durationSpan = document.createElement("span");
    durationSpan.textContent = track.duration
      ? formatTime(track.duration)
      : "--:--";

    meta.appendChild(dot);
    meta.appendChild(durationSpan);

    li.appendChild(title);
    li.appendChild(meta);

    li.addEventListener("click", () => {
      playIndex(index);
    });

    playlistEl.appendChild(li);
  });
}

function renderHome() {
  // Recents
  recentGrid.innerHTML = "";
  if (!state.recents.length) {
    recentGrid.textContent = "Әзірге бос";
    recentGrid.classList.add("empty-placeholder");
  } else {
    recentGrid.classList.remove("empty-placeholder");
    state.recents.forEach((t) => {
      const card = document.createElement("div");
      card.className = "recent-card";
      const cover = document.createElement("div");
      cover.className = "cover-sm";
      const name = document.createElement("div");
      name.className = "track-name";
      name.textContent = t.name;
      const sub = document.createElement("div");
      sub.className = "track-sub";
      sub.textContent = t.duration ? formatTime(t.duration) : "—";
      const textWrap = document.createElement("div");
      textWrap.style.minWidth = "0";
      textWrap.appendChild(name);
      textWrap.appendChild(sub);
      card.appendChild(textWrap);
      card.appendChild(cover);
      card.addEventListener("click", () => {
        const idx = state.tracks.findIndex((tr) => tr.id === t.id);
        if (idx >= 0) playIndex(idx);
      });
      recentGrid.appendChild(card);
    });
  }

  // Recommended static demo
  const recommended = [
    { name: "Neon Nights", artist: "Citywave" },
    { name: "Midnight Drive", artist: "Aurora Sky" },
    { name: "Chill Vibes", artist: "LoungeLab" },
    { name: "Deep Focus", artist: "ZeroNoise" },
  ];
  recommendGrid.innerHTML = "";
  recommended.forEach((rec) => {
    const card = document.createElement("div");
    card.className = "recommend-card";
    const cover = document.createElement("div");
    cover.className = "cover-lg";
    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = rec.name;
    const sub = document.createElement("div");
    sub.className = "track-sub";
    sub.textContent = rec.artist;
    card.appendChild(cover);
    card.appendChild(name);
    card.appendChild(sub);
    recommendGrid.appendChild(card);
  });
}

// Load specific track without autoplay
function loadTrack(index) {
  if (!state.tracks[index]) return;
  state.currentIndex = index;
  const track = state.tracks[index];
  if (!track.url) {
    console.warn("Track URL missing (not yet hydrated):", track);
    return;
  }
  audio.src = track.url;
  trackTitleEl.textContent = track.name;
  trackSubtitleEl.textContent = "FlowMusic • Local file";

  totalTimeEl.textContent = track.duration
    ? formatTime(track.duration)
    : "0:00";

  seekBar.value = 0;
  currentTimeEl.textContent = "0:00";

  updatePlaylistActive();
  // WebAudio graph is initialized on first user gesture (play)
}

// Load + play
function playIndex(index) {
  if (!state.tracks[index]) return;
  loadTrack(index);
  addRecent(state.tracks[index]);
  play();
}

function updatePlaylistActive() {
  const items = playlistEl.querySelectorAll(".playlist-item");
  items.forEach((li) => li.classList.remove("active"));
  if (!state.tracks.length) return;
  const current = playlistEl.querySelector(
    `.playlist-item[data-index="${state.currentIndex}"]`
  );
  if (current) current.classList.add("active");
}

// Playback controls
function play() {
  if (!state.tracks.length) return;
  if (!state.tracks[state.currentIndex]?.url) return;
  // Ensure WebAudio graph is created/resumed as part of a user gesture
  ensureAudioGraph();

  // Some browsers start AudioContext in 'suspended' until user gesture
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  audio.play().then(() => {
    state.isPlaying = true;
    btnPlay.textContent = "⏸";
    drawWaveform();
  }).catch((err) => {
    console.warn("Play failed:", err);
  });
}

function pause() {
  audio.pause();
  state.isPlaying = false;
  btnPlay.textContent = "▶";
  stopWaveform();
}

function togglePlayPause() {
  if (!state.tracks.length) return;
  if (state.isPlaying) pause();
  else play();
}

function nextTrack() {
  if (!state.tracks.length) return;
  if (state.isShuffle) {
    if (state.tracks.length === 1) {
      audio.currentTime = 0;
      play();
      return;
    }
    let idx = state.currentIndex;
    while (idx === state.currentIndex) {
      idx = Math.floor(Math.random() * state.tracks.length);
    }
    playIndex(idx);
    return;
  }

  if (state.currentIndex < state.tracks.length - 1) {
    playIndex(state.currentIndex + 1);
  } else {
    if (state.repeatMode === "all") {
      playIndex(0);
    } else {
      // off or one, just stop if at end
      audio.currentTime = 0;
      pause();
    }
  }
}

function prevTrack() {
  if (!state.tracks.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  if (state.currentIndex > 0) {
    playIndex(state.currentIndex - 1);
  } else {
    playIndex(state.tracks.length - 1);
  }
}

function toggleShuffle() {
  state.isShuffle = !state.isShuffle;
  btnShuffle.classList.toggle("active", state.isShuffle);
}

function cycleRepeatMode() {
  // off -> all -> one -> off
  if (state.repeatMode === "off") state.repeatMode = "all";
  else if (state.repeatMode === "all") state.repeatMode = "one";
  else state.repeatMode = "off";

  btnRepeat.classList.toggle("active", state.repeatMode !== "off");
  btnRepeat.textContent =
    state.repeatMode === "one" ? "🔂" : "🔁";
}

// Seek + volume
function handleTimeUpdate() {
  if (audio.duration) {
    const pct = (audio.currentTime / audio.duration) * 100;
    seekBar.value = pct;
  }
  currentTimeEl.textContent = formatTime(audio.currentTime);
}

function handleLoadedMetadata() {
  totalTimeEl.textContent = formatTime(audio.duration);

  const track = state.tracks[state.currentIndex];
  if (track && !track.duration) {
    track.duration = audio.duration;
    saveTracks();
    renderPlaylist();
  }
}

function handleSeekInput() {
  if (!audio.duration) return;
  const pct = parseFloat(seekBar.value);
  audio.currentTime = (pct / 100) * audio.duration;
}

function handleVolumeInput() {
  const vol = parseFloat(volumeBar.value);
  audio.volume = vol;
  saveVolume(vol);
}

// On ended
function handleEnded() {
  if (state.repeatMode === "one") {
    audio.currentTime = 0;
    play();
    return;
  }
  nextTrack();
}

function addRecent(track) {
  const entry = {
    id: track.id,
    name: track.name,
    duration: track.duration || null,
  };
  state.recents = state.recents.filter((t) => t.id !== track.id);
  state.recents.unshift(entry);
  state.recents = state.recents.slice(0, 8);
  saveRecents();
  renderHome();
}

// Add files
function addFiles(fileList) {
  const files = Array.from(fileList).filter((file) => {
    if (file.type.startsWith("audio/")) return true;
    const lower = file.name.toLowerCase();
    return (
      lower.endsWith(".mp3") ||
      lower.endsWith(".wav") ||
      lower.endsWith(".m4a") ||
      lower.endsWith(".ogg")
    );
  });

  if (!files.length) return;

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      const blob = new Blob([arrayBuffer], { type: file.type || "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const name = file.name.replace(/\.[^/.]+$/, "");

      const newTrack = {
        id,
        name,
        url,
        duration: null,
      };

      // Persist the file in IndexedDB (safe for large files)
      idbPutTrack({ id, name, type: blob.type, blob })
        .then(() => {
          state.tracks.push(newTrack);
          saveTracks();
          renderPlaylist();

          // If this is the first track added
          if (state.tracks.length === 1) {
            loadTrack(0);
          }

          // Load duration asynchronously
          const tempAudio = new Audio();
          tempAudio.src = url;
          tempAudio.addEventListener("loadedmetadata", () => {
            newTrack.duration = tempAudio.duration;
            saveTracks();
            renderPlaylist();
          });
        })
        .catch((err) => {
          console.warn("Failed to save track to IndexedDB:", err);
          // Fallback: keep in memory for this session
          state.tracks.push(newTrack);
          renderPlaylist();
        });
    };
    reader.readAsArrayBuffer(file);
  });
}

// Drag & drop handling
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

["dragenter", "dragover", "dragleave", "drop"].forEach((event) => {
  document.addEventListener(event, (e) => {
    if (event === "dragover" || event === "dragenter") {
      preventDefaults(e);
      dropZone.classList.add("drag-over");
    } else if (event === "dragleave") {
      preventDefaults(e);
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove("drag-over");
      }
    } else if (event === "drop") {
      preventDefaults(e);
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer && e.dataTransfer.files) {
        addFiles(e.dataTransfer.files);
      }
    }
  });
});

// Search within "Менің әндерім"
function handleSearchInput() {
  const term = searchInput.value.trim().toLowerCase();
  searchResults.innerHTML = "";
  if (!term) return;
  const matches = state.tracks.filter((t) =>
    t.name.toLowerCase().includes(term)
  );
  if (!matches.length) {
    const li = document.createElement("li");
    li.className = "playlist-item";
    li.style.opacity = "0.6";
    li.textContent = "Табылмады";
    searchResults.appendChild(li);
    return;
  }
  matches.forEach((track) => {
    const li = document.createElement("li");
    li.className = "playlist-item";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = track.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    const dot = document.createElement("span");
    dot.className = "dot";
    const durationSpan = document.createElement("span");
    durationSpan.textContent = track.duration ? formatTime(track.duration) : "--:--";
    meta.appendChild(dot);
    meta.appendChild(durationSpan);
    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener("click", () => {
      const idx = state.tracks.findIndex((t) => t.id === track.id);
      if (idx >= 0) playIndex(idx);
    });
    searchResults.appendChild(li);
  });
}
searchInput.addEventListener("input", handleSearchInput);

// File input
fileInput.addEventListener("change", (e) => {
  if (e.target.files) addFiles(e.target.files);
  fileInput.value = "";
});

// Buttons
btnPlay.addEventListener("click", togglePlayPause);
btnPrev.addEventListener("click", prevTrack);
btnNext.addEventListener("click", nextTrack);
btnShuffle.addEventListener("click", toggleShuffle);
btnRepeat.addEventListener("click", cycleRepeatMode);

// Audio events
audio.addEventListener("timeupdate", handleTimeUpdate);
audio.addEventListener("loadedmetadata", handleLoadedMetadata);
audio.addEventListener("ended", handleEnded);

// Range inputs
seekBar.addEventListener("input", handleSeekInput);
volumeBar.addEventListener("input", handleVolumeInput);

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const isTyping =
    active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");

  if (isTyping) return;

  if (e.code === "Space") {
    e.preventDefault();
    togglePlayPause();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    if (audio.currentTime >= 5) audio.currentTime -= 5;
    else audio.currentTime = 0;
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    if (audio.duration) {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    }
  }
});

// Waveform animation using Web Audio API
function ensureAudioGraph() {
  if (audioGraphReady) return;

  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    analyser = analyser || audioCtx.createAnalyser();
    analyser.fftSize = 256;

    // IMPORTANT: MediaElementSourceNode can be created only once per <audio>
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    audioGraphReady = true;
  } catch (e) {
    // If WebAudio fails, player should still work (just no waveform)
    console.warn("WebAudio init failed:", e);
    audioGraphReady = false;
    analyser = null;
  }
}

function drawWaveform() {
  if (!analyser) return;

  if (animationId) cancelAnimationFrame(animationId);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const width = waveCanvas.width;
  const height = waveCanvas.height;

  function draw() {
    animationId = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    canvasCtx.clearRect(0, 0, width, height);

    const barWidth = (width / bufferLength) * 1.4;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 255;
      const barHeight = v * height * 0.9;

      const grad = canvasCtx.createLinearGradient(
        0,
        height - barHeight,
        0,
        height
      );
      grad.addColorStop(0, "#00ffc6");
      grad.addColorStop(1, "#005746");

      canvasCtx.fillStyle = grad;
      canvasCtx.fillRect(
        x,
        height - barHeight,
        barWidth * 0.8,
        barHeight
      );

      x += barWidth;
    }

    // subtle central glow
    const glowRadius = height * 0.25;
    const centerX = width / 2;
    const centerY = height * 0.55;
    const gradient = canvasCtx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      glowRadius
    );
    gradient.addColorStop(0, "rgba(0,255,198,0.25)");
    gradient.addColorStop(1, "transparent");
    canvasCtx.fillStyle = gradient;
    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
    canvasCtx.fill();
  }

  draw();
}

function stopWaveform() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// Resize canvas to container size
function resizeCanvas() {
  const rect = waveCanvas.getBoundingClientRect();
  waveCanvas.width = rect.width * window.devicePixelRatio;
  waveCanvas.height = rect.height * window.devicePixelRatio;
  canvasCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}
window.addEventListener("resize", resizeCanvas);

// Tab navigation
function switchTab(tab) {
  state.currentTab = tab;
  const sections = {
    home: homeSection,
    search: searchSection,
    mysongs: mySongsSection,
    profile: profileSection,
  };
  Object.entries(sections).forEach(([key, el]) => {
    if (el) el.classList.toggle("hidden", key !== tab);
  });
  navButtons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === tab)
  );
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// Init
function init() {
  resizeCanvas();
  loadTracks();
  loadVolume();
  loadRecents();
  hydrateTrackUrlsFromDb().then(() => {
    renderPlaylist();
    renderHome();
    profileCount.textContent = state.tracks.length;
    if (state.tracks.length > 0) {
      // Make sure first track is hydrated
      if (state.tracks[0].url) loadTrack(0);
    }
  });
  switchTab(state.currentTab);
}

document.addEventListener("DOMContentLoaded", init);document.addEventListener("DOMContentLoaded", init);