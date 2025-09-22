const socket = io({ transports: ['websocket'] });

const TICK_RATE = 20;
const PLAYER_COLORS = {
  '#ff4d4f': '🔥',
  '#40a9ff': '❄️',
  '#52c41a': '🌿',
  '#faad14': '⚡',
  '#9254de': '🔮',
  '#fa541c': '🌋',
  '#eb2f96': '🌸',
  '#13c2c2': '💎'
};
const PLAYER_COLOR_KEYS = Object.keys(PLAYER_COLORS);

const GAME_MODES = [
  { key: 'classic', label: '클래식 모드', description: '표준 규격의 밸런스 모드' },
  { key: 'battle', label: '배틀 모드', description: '파워업과 음식이 풍부한 전투 중심 모드' },
  { key: 'speed', label: '스피드 모드', description: '빠른 이동 속도로 승부를 보는 모드' },
  { key: 'tournament', label: '토너먼트 모드', description: '여러 라운드를 거쳐 최종 우승자를 결정하는 모드' }
];

const MODE_MAP = new Map(GAME_MODES.map((mode) => [mode.key, mode]));

const PHASE_LABEL = {
  waiting: '대기',
  countdown: '카운트다운',
  running: '진행',
  ended: '종료',
  intermission: '라운드 대기'
};

const POWERUP_LABEL = {
  speed: '속도 증가',
  shield: '무적',
  shrink: '작아지기'
};

const POWERUP_ICON = {
  speed: '⚡',
  shield: '🛡',
  shrink: '🌀'
};

const elements = {
  status: document.getElementById('connection-status'),
  toggleAudio: document.getElementById('toggle-audio'),
  replayButton: document.getElementById('request-replay'),
  closeReplay: document.getElementById('close-replay'),
  replayModal: document.getElementById('replay-modal'),
  replayPlay: document.getElementById('replay-play'),
  replayPause: document.getElementById('replay-pause'),
  replaySpeed: document.getElementById('replay-speed'),
  replayProgress: document.getElementById('replay-progress'),
  replayCanvas: document.getElementById('replay-canvas'),
  nameInput: document.getElementById('player-name'),
  colorPalette: document.getElementById('color-palette'),
  colorPreview: document.getElementById('color-preview'),
  quickJoin: document.getElementById('quick-join'),
  createRoom: document.getElementById('create-room'),
  joinRoom: document.getElementById('join-room'),
  refreshRooms: document.getElementById('refresh-rooms'),
  privateToggle: document.getElementById('private-room-toggle'),
  modeSelect: document.getElementById('game-mode'),
  modeDescription: document.getElementById('mode-description'),
  roomId: document.getElementById('room-id'),
  roomList: document.getElementById('room-list'),
  statsTableBody: document.querySelector('#stats-table tbody'),
  statsUpdated: document.getElementById('stats-updated'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-message'),
  chatLog: document.getElementById('chat-log'),
  notificationList: document.getElementById('notification-list'),
  scoreboardBody: document.querySelector('#scoreboard tbody'),
  aliveList: document.getElementById('alive-list'),
  effectsList: document.getElementById('player-effects'),
  playerProfile: document.getElementById('player-profile'),
  playerStatus: document.getElementById('player-status'),
  tournamentSection: document.getElementById('tournament-section'),
  tournamentWins: document.getElementById('tournament-wins'),
  tournamentRounds: document.getElementById('tournament-rounds'),
  tournamentTimer: document.getElementById('tournament-timer'),
  modeIndicator: document.getElementById('mode-indicator'),
  worldInfo: document.getElementById('world-info'),
  overlay: document.getElementById('game-overlay'),
  countdown: document.getElementById('countdown'),
  canvas: document.getElementById('game-canvas')
};

elements.colorButtons = [...(elements.colorPalette?.querySelectorAll('button') || [])];

const ctx = elements.canvas.getContext('2d');
const replayCtx = elements.replayCanvas.getContext('2d');

const state = {
  playerId: null,
  roomId: null,
  world: { width: 1600, height: 900, segmentSize: 12 },
  rooms: [],
  game: null,
  lastState: null,
  notifications: [],
  chat: [],
  replay: {
    frames: [],
    playing: false,
    index: 0,
    speed: 1,
    lastUpdate: 0
  },
  audioEnabled: false,
  audioReady: false,
  preferences: {
    color: PLAYER_COLOR_KEYS[0],
    mode: GAME_MODES[0].key
  },
  personal: {
    lastScore: 0,
    alive: true,
    profile: null
  }
};

class AudioManager {
  constructor() {
    this.context = null;
    this.master = null;
    this.bgm = null;
  }

  async setup() {
    if (this.context) return;
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.context.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.context.destination);
    state.audioReady = true;
  }

  async enable() {
    await this.setup();
    if (state.audioEnabled) return;
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    state.audioEnabled = true;
    this.playBgm();
  }

  disable() {
    state.audioEnabled = false;
    this.stopBgm();
  }

  stopBgm() {
    if (this.bgm) {
      try {
        this.bgm.stop();
      } catch (err) {
        // ignore
      }
      this.bgm.disconnect();
      this.bgm = null;
    }
  }

  playBgm() {
    if (!state.audioEnabled || !this.context) return;
    this.stopBgm();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 96;
    const lfo = this.context.createOscillator();
    const lfoGain = this.context.createGain();
    lfo.frequency.value = 0.2;
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.value = 0.08;
    osc.connect(gain).connect(this.master);
    osc.start();
    lfo.start();
    this.bgm = osc;
  }

  blip({ freq = 440, duration = 0.18, type = 'sine', gainValue = 0.18 } = {}) {
    if (!state.audioEnabled || !this.context) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(gainValue, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(this.context.currentTime + duration + 0.05);
  }

  playFood() {
    this.blip({ freq: 660, duration: 0.12, type: 'triangle', gainValue: 0.2 });
  }

  playDeath() {
    this.blip({ freq: 120, duration: 0.45, type: 'sawtooth', gainValue: 0.25 });
  }

  playWin() {
    this.blip({ freq: 880, duration: 0.3, type: 'square', gainValue: 0.22 });
  }
}

const audio = new AudioManager();

const directionKeys = new Map([
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
  ['ArrowLeft', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
  ['KeyW', { x: 0, y: -1 }],
  ['KeyS', { x: 0, y: 1 }],
  ['KeyA', { x: -1, y: 0 }],
  ['KeyD', { x: 1, y: 0 }]
]);

const notify = (message, type = 'info') => {
  const entry = {
    id: crypto.randomUUID(),
    message,
    type,
    timestamp: Date.now()
  };
  state.notifications.unshift(entry);
  state.notifications = state.notifications.slice(0, 20);
  renderNotifications();
};

const renderColorPalette = () => {
  if (!elements.colorButtons?.length) return;
  elements.colorButtons.forEach((button) => {
    const color = button.dataset.color;
    if (!color) return;
    button.style.setProperty('--picker-color', color);
    const selected = color === state.preferences.color;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  if (elements.colorPreview) {
    elements.colorPreview.style.setProperty('--preview-color', state.preferences.color);
    const badge = PLAYER_COLORS[state.preferences.color] || '';
    const label = badge ? `${badge} ${state.preferences.color}` : state.preferences.color;
    elements.colorPreview.textContent = `선택 색상: ${label}`;
  }
};

const applyPreferredColor = (color, { attemptChange = false } = {}) => {
  if (!PLAYER_COLOR_KEYS.includes(color)) return;
  const previous = state.preferences.color;
  state.preferences.color = color;
  renderColorPalette();
  if (attemptChange && state.playerId) {
    socket.emit('player:color-change', { playerId: state.playerId, color }, (response = {}) => {
      if (response.error) {
        notify(response.error, 'warn');
        state.preferences.color = previous;
        renderColorPalette();
        return;
      }
      if (response.color) {
        state.preferences.color = response.color;
        renderColorPalette();
      }
    });
  }
};

const populateModeOptions = () => {
  if (!elements.modeSelect) return;
  elements.modeSelect.innerHTML = GAME_MODES.map((mode) => `<option value="${mode.key}">${mode.label}</option>`).join('');
  if (!MODE_MAP.has(state.preferences.mode)) {
    state.preferences.mode = GAME_MODES[0].key;
  }
  elements.modeSelect.value = state.preferences.mode;
  updateModeDescription();
};

const updateModeDescription = () => {
  if (!elements.modeDescription) return;
  const mode = MODE_MAP.get(state.preferences.mode) || GAME_MODES[0];
  elements.modeDescription.textContent = mode.description;
};

const updateModeIndicator = () => {
  if (!elements.modeIndicator) return;
  const modeInfo = state.game?.mode;
  if (!modeInfo) {
    elements.modeIndicator.textContent = '모드: 로비';
    return;
  }
  const phaseLabel = PHASE_LABEL[state.game?.phase] || '대기';
  elements.modeIndicator.textContent = `모드: ${modeInfo.label} · ${phaseLabel}`;
};

const formatTime = (ms) => {
  const date = new Date(ms);
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
};

populateModeOptions();
renderColorPalette();
updateModeIndicator();

elements.colorButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!button.dataset.color) return;
    applyPreferredColor(button.dataset.color, { attemptChange: true });
  });
});

if (elements.modeSelect) {
  elements.modeSelect.addEventListener('change', (event) => {
    const selected = event.target.value;
    if (MODE_MAP.has(selected)) {
      state.preferences.mode = selected;
    } else {
      state.preferences.mode = GAME_MODES[0].key;
    }
    updateModeDescription();
  });
}

const renderNotifications = () => {
  elements.notificationList.innerHTML = state.notifications
    .map(
      (note) => `
        <li data-type="${note.type}">
          <strong>${formatTime(note.timestamp)}</strong>
          <div>${note.message}</div>
        </li>`
    )
    .join('');
};

const setStatus = (text, error = false) => {
  elements.status.textContent = text;
  elements.status.classList.toggle('status--error', error);
};

const joinRoomCallback = (error, payload) => {
  if (error) {
    notify(error, 'error');
    setStatus(error, true);
    return;
  }
  setStatus(`${payload.name} 방에 입장했습니다.`);
};

const requestJoin = (action, data) => {
  return new Promise((resolve) => {
    socket.emit(action, data, (response) => {
      if (response?.error) {
        joinRoomCallback(response.error, null);
        resolve(false);
      } else {
        joinRoomCallback(null, response);
        resolve(true);
      }
    });
  });
};

const renderRooms = () => {
  if (!state.rooms.length) {
    elements.roomList.classList.add('empty');
    elements.roomList.innerHTML = '<li>참여 가능한 방이 없습니다.</li>';
    return;
  }
  elements.roomList.classList.remove('empty');
  elements.roomList.innerHTML = state.rooms
    .map(
      (room) => {
        const phaseMap = {
          waiting: '대기중',
          countdown: '시작 대기',
          running: '진행중',
          intermission: '인터미션',
          ended: '종료'
        };
        const phaseText = phaseMap[room.phase] || '진행중';
        const modeLabel = room.mode?.label || '모드 미정';
        return `
        <li>
          <div>
            <div><strong>${room.name}</strong></div>
            <div class="sub">${room.id} · ${room.players}명 · ${modeLabel} · ${phaseText}</div>
          </div>
          <button class="btn btn--primary" data-room="${room.id}">입장</button>
        </li>`;
      }
    )
    .join('');

  elements.roomList.querySelectorAll('button[data-room]').forEach((button) => {
    button.addEventListener('click', async () => {
      const playerName = getPlayerName();
      await requestJoin('room:join', {
        roomId: button.dataset.room,
        playerName,
        preferredColor: state.preferences.color
      });
    });
  });
};

const fetchStats = async () => {
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) throw new Error('stats fetch failed');
    const data = await response.json();
    const updated = new Date(data.updatedAt);
    elements.statsUpdated.textContent = `${updated.getHours().toString().padStart(2, '0')}:${updated
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
    const rows = data.players
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 8)
      .map(
        (row) => `
          <tr>
            <td>${row.name}</td>
            <td>${row.winRate}%</td>
            <td>${row.averageScore}</td>
            <td>${row.averageSurvivalSeconds}s</td>
          </tr>`
      )
      .join('');
    elements.statsTableBody.innerHTML = rows || '<tr><td colspan="4" class="empty">데이터가 없습니다</td></tr>';
  } catch (error) {
    elements.statsTableBody.innerHTML = '<tr><td colspan="4" class="empty">통계를 불러오지 못했습니다</td></tr>';
  }
};

const getPlayerName = () => {
  const raw = elements.nameInput.value.trim();
  return raw ? raw.slice(0, 16) : 'Player';
};

const handleInput = (event) => {
  const direction = directionKeys.get(event.code);
  if (!direction || !state.playerId) return;
  socket.emit('player:input', {
    playerId: state.playerId,
    direction
  });
};

document.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
  handleInput(event);
});

const updateScoreboard = () => {
  const leaderboard = state.game?.leaderboard || [];
  if (!leaderboard.length) {
    elements.scoreboardBody.innerHTML = '<tr><td colspan="3" class="empty">대기 중</td></tr>';
    return;
  }
  elements.scoreboardBody.innerHTML = leaderboard
    .map((entry) => {
      const highlight = entry.id === state.playerId ? ' style="color: var(--accent); font-weight:600"' : '';
      return `
        <tr${highlight}>
          <td>${entry.name}${entry.alive ? '' : ' 💀'}</td>
          <td>${entry.score}</td>
          <td>${entry.kills}</td>
        </tr>`;
    })
    .join('');
};

const updateAliveList = () => {
  const players = state.game?.players || [];
  const alive = players.filter((p) => p.alive);
  elements.aliveList.innerHTML = alive
    .map((p) => `<li style="background:${p.color}1f;border:1px solid ${p.color}4d">${p.name}</li>`)
    .join('');
};

const renderPlayerProfile = () => {
  const container = elements.playerProfile;
  if (!container) return;
  const profile = state.personal.profile;
  if (!state.playerId || !profile) {
    container.innerHTML = `
      <li><span>게임 수</span><strong>-</strong></li>
      <li><span>승률</span><strong>-</strong></li>
      <li><span>평균 점수</span><strong>-</strong></li>
      <li><span>최고 점수</span><strong>-</strong></li>`;
    return;
  }
  const games = profile.games || 0;
  const wins = profile.wins || 0;
  const averageScore = games ? Math.round((profile.totalScore || 0) / games) : 0;
  const bestScore = profile.bestScore || 0;
  const winRate = games ? ((wins / games) * 100).toFixed(1) : '0.0';
  container.innerHTML = `
    <li><span>게임 수</span><strong>${games}</strong></li>
    <li><span>승률</span><strong>${winRate}%</strong></li>
    <li><span>평균 점수</span><strong>${averageScore}</strong></li>
    <li><span>최고 점수</span><strong>${bestScore}</strong></li>`;
};

const updatePlayerStatus = () => {
  if (!state.playerId) {
    elements.playerStatus.textContent = '대기 중';
    elements.effectsList.innerHTML = '';
    renderPlayerProfile();
    return;
  }
  const me = state.game?.players?.find((p) => p.id === state.playerId);
  if (!me) {
    elements.playerStatus.textContent = '관전 중';
    elements.effectsList.innerHTML = '';
    renderPlayerProfile();
    return;
  }
  elements.playerStatus.textContent = me.alive ? '전투 중' : '탈락 (관전 가능)';
  elements.effectsList.innerHTML = (me.effects || [])
    .map((effect) => `<li>${POWERUP_ICON[effect] || '✨'} ${POWERUP_LABEL[effect] || effect}</li>`)
    .join('');
  renderPlayerProfile();
};

const updateTournamentStatus = () => {
  const container = elements.tournamentSection;
  if (!container) return;
  const tournament = state.game?.tournament;
  if (!tournament?.enabled) {
    container.classList.add('is-hidden');
    if (elements.tournamentWins) elements.tournamentWins.innerHTML = '';
    if (elements.tournamentRounds) elements.tournamentRounds.textContent = '토너먼트 미진행';
    if (elements.tournamentTimer) elements.tournamentTimer.textContent = '';
    return;
  }
  container.classList.remove('is-hidden');
  const currentRound = tournament.currentRound || 0;
  if (elements.tournamentRounds) {
    elements.tournamentRounds.textContent = `목표 ${tournament.roundsToWin}승 · 현재 라운드 ${currentRound}`;
  }
  if (elements.tournamentTimer) {
    const timerText = tournament.championId
      ? '토너먼트 종료'
      : tournament.intermissionRemaining
      ? `다음 라운드까지 ${tournament.intermissionRemaining}s`
      : '';
    elements.tournamentTimer.textContent = timerText;
  }
  if (elements.tournamentWins) {
    const winsMarkup = (tournament.wins || [])
      .map((entry) => {
        const championClass = tournament.championId === entry.playerId ? ' class="champion"' : '';
        return `<li${championClass} style="border-left: 4px solid ${entry.color}"><strong>${entry.name}</strong><span>${entry.wins}승</span></li>`;
      })
      .join('');
    elements.tournamentWins.innerHTML = winsMarkup || '<li class="empty">아직 승자가 없습니다</li>';
  }
};

const setOverlay = (text) => {
  if (!text) {
    elements.overlay.classList.add('hidden');
    elements.overlay.textContent = '';
    return;
  }
  elements.overlay.textContent = text;
  elements.overlay.classList.remove('hidden');
};

const updateCountdown = () => {
  if (!state.game) {
    elements.countdown.classList.remove('active');
    return;
  }
  if (state.game.phase === 'countdown' && state.game.countdown >= 0) {
    elements.countdown.textContent = `시작까지 ${state.game.countdown}s`;
    elements.countdown.classList.add('active');
  } else if (state.game.phase === 'intermission' && state.game.intermission > 0) {
    elements.countdown.textContent = `다음 라운드까지 ${state.game.intermission}s`;
    elements.countdown.classList.add('active');
  } else {
    elements.countdown.classList.remove('active');
  }
};

const updateHud = () => {
  updateScoreboard();
  updateAliveList();
  updatePlayerStatus();
  updateTournamentStatus();
  updateModeIndicator();
  updateCountdown();
};

const handleGamePhase = () => {
  if (!state.game) {
    setOverlay('게임에 참가하여 전투를 시작하세요!');
    return;
  }
  switch (state.game.phase) {
    case 'waiting':
      setOverlay('플레이어 대기 중... 최소 2명 필요');
      break;
    case 'countdown':
      setOverlay(null);
      break;
    case 'running':
      setOverlay(null);
      break;
    case 'intermission': {
      const seconds = state.game.intermission || 0;
      setOverlay(`다음 라운드를 준비 중... ${seconds}s`);
      break;
    }
    case 'ended': {
      const winner = state.game.leaderboard?.[0];
      setOverlay(winner ? `${winner.name}님의 승리!` : '무승부!');
      break;
    }
    default:
      setOverlay(null);
  }
};

const renderChat = () => {
  elements.chatLog.innerHTML = state.chat
    .map(
      (msg) => `
      <div class="chat__message">
        <div class="chat__author" style="color:${msg.color}">${msg.author}</div>
        <div class="chat__text">${msg.message}</div>
        <div class="chat__timestamp">${formatTime(msg.timestamp)}</div>
      </div>`
    )
    .join('');
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
};

const handleChatSubmit = (event) => {
  event.preventDefault();
  const message = elements.chatInput.value.trim();
  if (!message || !state.roomId || !state.playerId) return;
  socket.emit('chat:message', {
    roomId: state.roomId,
    playerId: state.playerId,
    message
  });
  elements.chatInput.value = '';
};

elements.chatForm.addEventListener('submit', handleChatSubmit);

elements.quickJoin.addEventListener('click', async () => {
  const playerName = getPlayerName();
  await requestJoin('room:quick-join', {
    playerName,
    preferredColor: state.preferences.color,
    mode: state.preferences.mode
  });
});

elements.createRoom.addEventListener('click', async () => {
  const playerName = getPlayerName();
  await requestJoin('room:create', {
    name: `${playerName}의 방`,
    isPrivate: elements.privateToggle.checked,
    playerName,
    preferredColor: state.preferences.color,
    mode: state.preferences.mode
  });
});

elements.joinRoom.addEventListener('click', async () => {
  const roomId = elements.roomId.value.trim();
  if (!roomId) {
    notify('방 코드를 입력해주세요', 'warn');
    return;
  }
  const playerName = getPlayerName();
  await requestJoin('room:join', { roomId, playerName, preferredColor: state.preferences.color });
});

elements.refreshRooms.addEventListener('click', () => {
  socket.emit('rooms:refresh');
});

socket.on('rooms:list', (rooms) => {
  state.rooms = rooms;
  renderRooms();
});

socket.on('rooms:updated', (rooms) => {
  state.rooms = rooms;
  renderRooms();
});

socket.on('player:assigned', ({ playerId, roomId, world, color, mode }) => {
  state.playerId = playerId;
  state.roomId = roomId;
  state.world = world;
  state.personal.profile = null;
  renderPlayerProfile();
  const previousColor = state.preferences.color;
  if (color && PLAYER_COLOR_KEYS.includes(color)) {
    applyPreferredColor(color);
    if (previousColor && previousColor !== color) {
      notify('선택한 색상이 이미 사용 중이라 다른 색상이 배정되었습니다.', 'warn');
    }
  }
  if (mode?.key && MODE_MAP.has(mode.key)) {
    state.preferences.mode = mode.key;
    if (elements.modeSelect) {
      elements.modeSelect.value = mode.key;
      updateModeDescription();
    }
  }
  elements.worldInfo.textContent = `맵: ${world.width} x ${world.height}`;
  elements.replayButton.disabled = true;
  notify(`플레이어 ID가 부여되었습니다 (${playerId.slice(0, 6)})`);
  if (state.audioEnabled) audio.playBgm();
});

socket.on('player:profile', (profile) => {
  state.personal.profile = profile || null;
  renderPlayerProfile();
});

socket.on('game:state', (gameState) => {
  state.game = gameState;
  handleGamePhase();
  updateHud();
  if (state.playerId) {
    const me = gameState.players?.find((p) => p.id === state.playerId);
    if (me) {
      if (me.score > state.personal.lastScore) {
        audio.playFood();
      }
      if (state.personal.alive && !me.alive) {
        audio.playDeath();
        notify('탈락했습니다. 관전 모드!', 'warn');
      }
      state.personal.lastScore = me.score;
      state.personal.alive = me.alive;
    }
  }
});

socket.on('game:ended', ({ winnerId, leaderboard, tournament }) => {
  elements.replayButton.disabled = false;
  const winner = leaderboard?.find((item) => item.id === winnerId);
  if (tournament?.championId) {
    const champion = leaderboard?.find((entry) => entry.id === tournament.championId);
    if (champion) {
      notify(`${champion.name}님이 토너먼트 우승을 차지했습니다!`, 'success');
      if (champion.id === state.playerId) audio.playWin();
    }
  } else if (winner) {
    notify(`${winner.name}님의 승리! 축하합니다!`, 'success');
    if (winnerId === state.playerId) audio.playWin();
  } else {
    notify('게임이 종료되었습니다.', 'info');
  }
});

socket.on('chat:message', (message) => {
  state.chat.push(message);
  state.chat = state.chat.slice(-80);
  renderChat();
});

socket.on('room:notification', (note) => {
  notify(note.message, note.type || 'info');
});

socket.on('room:replay', ({ frames }) => {
  if (!frames?.length) {
    notify('리플레이 데이터가 없습니다.', 'warn');
    return;
  }
  state.replay.frames = frames;
  state.replay.index = 0;
  state.replay.playing = false;
  elements.replayProgress.max = Math.max(1, frames.length - 1);
  elements.replayProgress.value = 0;
  elements.replayModal.classList.remove('hidden');
  notify('리플레이 준비 완료');
});

socket.io.on('open', () => {
  setStatus('서버와 연결되었습니다.');
});

socket.io.on('close', () => {
  setStatus('서버 연결 끊김', true);
  elements.replayButton.disabled = true;
});

socket.io.on('reconnect_attempt', () => {
  setStatus('서버 재연결 중...');
});

socket.io.on('reconnect', () => {
  setStatus('서버 재연결 완료');
});

const drawGrid = (context, width, height, spacing) => {
  context.strokeStyle = 'rgba(255,255,255,0.08)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = spacing / 2; x <= width; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = spacing / 2; y <= height; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
};

const drawFood = (context, food) => {
  food.forEach((item) => {
    const radius = item.type === 'golden' ? 10 : 7;
    const gradient = context.createRadialGradient(item.x, item.y, radius * 0.2, item.x, item.y, radius);
    if (item.type === 'golden') {
      gradient.addColorStop(0, '#fff7d6');
      gradient.addColorStop(1, '#f5b301');
    } else {
      gradient.addColorStop(0, '#b3ffec');
      gradient.addColorStop(1, '#1fb6ff');
    }
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(item.x, item.y, radius, 0, Math.PI * 2);
    context.fill();
  });
};

const drawPowerups = (context, powerups) => {
  powerups.forEach((power) => {
    context.save();
    context.translate(power.x, power.y);
    context.fillStyle = {
      speed: '#ffad14',
      shield: '#13c2c2',
      shrink: '#9254de'
    }[power.type];
    context.strokeStyle = 'rgba(255,255,255,0.45)';
    context.lineWidth = 2;
    context.beginPath();
    const size = 14;
    context.moveTo(0, -size);
    context.lineTo(size, 0);
    context.lineTo(0, size);
    context.lineTo(-size, 0);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  });
};

const drawPlayers = (context, players) => {
  players.forEach((player) => {
    const { segments = [], color, alive } = player;
    if (!segments.length) return;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = `${color}b3`;
    context.fillStyle = color;
    for (let i = segments.length - 1; i >= 1; i -= 1) {
      const current = segments[i];
      const prev = segments[i - 1];
      context.strokeStyle = `${color}${alive ? '90' : '30'}`;
      context.lineWidth = 10;
      context.beginPath();
      context.moveTo(prev.x, prev.y);
      context.lineTo(current.x, current.y);
      context.stroke();
    }
    const head = segments[0];
    context.beginPath();
    context.fillStyle = alive ? color : `${color}55`;
    context.arc(head.x, head.y, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#0d1117';
    context.beginPath();
    context.arc(head.x + 2, head.y - 2, 2, 0, Math.PI * 2);
    context.arc(head.x - 2, head.y - 2, 2, 0, Math.PI * 2);
    context.fill();
  });
};

const render = () => {
  requestAnimationFrame(render);
  const gameState = state.replay.playing ? state.replay.frames[state.replay.index] : state.game;
  const world = state.world;
  if (!world || !gameState) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
    return;
  }

  if (elements.canvas.width !== world.width || elements.canvas.height !== world.height) {
    elements.canvas.width = world.width;
    elements.canvas.height = world.height;
  }

  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, world.width, world.height);
  drawGrid(ctx, world.width, world.height, world.segmentSize * 4);
  drawFood(ctx, gameState.food || []);
  drawPowerups(ctx, gameState.powerups || []);
  drawPlayers(ctx, gameState.players || []);
};

const renderReplay = () => {
  requestAnimationFrame(renderReplay);
  const replay = state.replay;
  if (!replay.frames.length) {
    replayCtx.fillStyle = '#050505';
    replayCtx.fillRect(0, 0, elements.replayCanvas.width, elements.replayCanvas.height);
    return;
  }

  if (elements.replayCanvas.width !== state.world.width || elements.replayCanvas.height !== state.world.height) {
    elements.replayCanvas.width = state.world.width;
    elements.replayCanvas.height = state.world.height;
  }

  if (replay.playing) {
    const now = performance.now();
    if (!replay.lastUpdate) replay.lastUpdate = now;
    const delta = (now - replay.lastUpdate) / 1000;
    const advance = delta * TICK_RATE * replay.speed;
    if (advance >= 1) {
      replay.index = Math.min(replay.frames.length - 1, replay.index + Math.floor(advance));
      replay.lastUpdate = now;
      elements.replayProgress.value = replay.index;
      if (replay.index >= replay.frames.length - 1) {
        replay.playing = false;
      }
    }
  }

  const frame = replay.frames[replay.index];
  replayCtx.fillStyle = '#050510';
  replayCtx.fillRect(0, 0, state.world.width, state.world.height);
  drawGrid(replayCtx, state.world.width, state.world.height, state.world.segmentSize * 4);
  drawFood(replayCtx, frame.food || []);
  drawPowerups(replayCtx, frame.powerups || []);
  drawPlayers(replayCtx, frame.players || []);
};

render();
renderReplay();

const closeReplay = () => {
  state.replay.playing = false;
  elements.replayModal.classList.add('hidden');
};

elements.closeReplay.addEventListener('click', () => {
  closeReplay();
});

const playReplay = () => {
  if (!state.replay.frames.length) return;
  state.replay.playing = true;
  state.replay.lastUpdate = performance.now();
};

elements.replayPlay.addEventListener('click', () => {
  playReplay();
});

elements.replayPause.addEventListener('click', () => {
  state.replay.playing = false;
});

elements.replaySpeed.addEventListener('input', (event) => {
  state.replay.speed = parseFloat(event.target.value);
});

elements.replayProgress.addEventListener('input', (event) => {
  state.replay.index = parseInt(event.target.value, 10) || 0;
  state.replay.playing = false;
});

elements.replayButton.addEventListener('click', () => {
  if (!state.roomId) {
    notify('먼저 게임에 참여하세요.', 'warn');
    return;
  }
  socket.emit('room:request-replay', { roomId: state.roomId });
});

const toggleAudio = async () => {
  if (!state.audioEnabled) {
    await audio.enable();
    elements.toggleAudio.textContent = '🔇 사운드 끄기';
    notify('사운드가 활성화되었습니다.');
  } else {
    audio.disable();
    elements.toggleAudio.textContent = '🔊 사운드 켜기';
    notify('사운드가 비활성화되었습니다.');
  }
};

elements.toggleAudio.addEventListener('click', () => {
  toggleAudio();
});

elements.nameInput.addEventListener('blur', () => {
  elements.nameInput.value = getPlayerName();
});

fetchStats();
setInterval(fetchStats, 60000);

notify('온라인 지렁이 배틀에 오신 것을 환영합니다!');
