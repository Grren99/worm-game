import { MODE_MAP, PLAYER_COLOR_KEYS } from './state.js';

const buildPlayerMap = (players = []) => {
  const map = new Map();
  players.forEach((player) => {
    map.set(player.id, player);
  });
  return map;
};

const buildHighlightState = ({ favorites = [], filters = { query: '', tags: [] }, importReports = [] } = {}) => ({
  clips: [],
  summary: null,
  stats: [],
  favorites,
  recommendations: [],
  filters,
  importReports
});

const EFFECT_COLORS = {
  speed: '#faad14',
  shield: '#13c2c2',
  shrink: '#9254de'
};

export class NetworkController {
  constructor({ state, socket, ui, audio, renderer }) {
    this.state = state;
    this.socket = socket;
    this.ui = ui;
    this.audio = audio;
    this.renderer = renderer;
  }

  init() {
    this.socket.on('rooms:list', (rooms) => {
      this.state.rooms = rooms;
      this.ui.renderRooms();
    });

    this.socket.on('rooms:updated', (rooms) => {
      this.state.rooms = rooms;
      this.ui.renderRooms();
    });

    this.socket.on('player:assigned', ({ playerId, roomId, world, color, mode }) => {
      this.state.playerId = playerId;
      this.state.roomId = roomId;
      this.state.world = world;
      this.state.personal.profile = null;
      this.ui.renderPlayerProfile();
      this.state.achievements = [];
      this.ui.renderAchievements();
      const previousColor = this.state.preferences.color;
      if (color && PLAYER_COLOR_KEYS.includes(color)) {
        this.ui.applyPreferredColor(color);
        if (previousColor && previousColor !== color) {
          this.ui.notify('선택한 색상이 이미 사용 중이라 다른 색상이 배정되었습니다.', 'warn');
        }
      }
      if (mode?.key && MODE_MAP.has(mode.key)) {
        this.state.preferences.mode = mode.key;
        if (this.ui.elements.modeSelect) {
          this.ui.elements.modeSelect.value = mode.key;
          this.ui.updateModeDescription();
        }
      }
      this.ui.elements.worldInfo.textContent = `맵: ${world.width} x ${world.height}`;
      this.ui.elements.replayButton.disabled = true;
      this.ui.notify(`플레이어 ID가 부여되었습니다 (${playerId.slice(0, 6)})`);
      const favorites = this.state.highlights?.favorites || [];
      const filters = this.state.highlights?.filters || { query: '', tags: [] };
      const importReports = this.state.highlights?.importReports || [];
      this.state.highlights = buildHighlightState({ favorites, filters, importReports });
      this.ui.renderHighlights();
      if (this.state.audioEnabled) this.audio.playBgm();
    });

    this.socket.on('player:profile', (profile) => {
      this.state.personal.profile = profile || null;
      this.ui.renderPlayerProfile();
    });

    this.socket.on('game:state', (gameState) => {
      this.handleGameState(gameState);
    });

    this.socket.on('game:ended', ({ winnerId, leaderboard, tournament, highlights, achievements }) => {
      if (typeof this.audio?.playMatchEnd === 'function') {
        this.audio.playMatchEnd();
      }
      this.ui.elements.replayButton.disabled = false;
      const winner = leaderboard?.find((item) => item.id === winnerId);
      if (tournament?.championId) {
        const champion = leaderboard?.find((entry) => entry.id === tournament.championId);
        if (champion) {
          this.ui.notify(`${champion.name}님이 토너먼트 우승을 차지했습니다!`, 'success');
          if (champion.id === this.state.playerId) this.audio.playWin();
        }
      } else if (winner) {
        this.ui.notify(`${winner.name}님의 승리! 축하합니다!`, 'success');
        if (winnerId === this.state.playerId) this.audio.playWin();
      } else {
        this.ui.notify('게임이 종료되었습니다.', 'info');
      }
      const favorites = this.state.highlights?.favorites || [];
      const filters = this.state.highlights?.filters || { query: '', tags: [] };
      const importReports = this.state.highlights?.importReports || [];
      if (highlights) {
        this.state.highlights = {
          clips: Array.isArray(highlights.clips) ? highlights.clips : [],
          summary: highlights.summary || null,
          stats: Array.isArray(highlights.stats) ? highlights.stats : [],
          favorites,
          recommendations: [],
          filters,
          importReports
        };
      } else {
        this.state.highlights = buildHighlightState({ favorites, filters, importReports });
      }
      this.ui.renderHighlights();
      if (Array.isArray(achievements)) {
        this.state.achievements = achievements;
      } else {
        this.state.achievements = [];
      }
      this.ui.renderAchievements();
    });

    this.socket.on('chat:message', (message) => {
      this.state.chat.push(message);
      this.state.chat = this.state.chat.slice(-80);
      this.ui.renderChat();
    });

    this.socket.on('room:notification', (note = {}) => {
      const type = note.type || 'info';
      this.ui.notify(note.message, type);
      if (typeof this.audio?.playNotification === 'function') {
        const normalized = type === 'warning' ? 'warn' : type;
        this.audio.playNotification(normalized);
      }
    });

    this.socket.on('room:replay', ({ frames }) => {
      this.ui.openReplayModal(frames);
    });

    this.socket.io.on('open', () => {
      this.ui.setStatus('서버와 연결되었습니다.');
    });

    this.socket.io.on('close', () => {
      this.ui.setStatus('서버 연결 끊김', true);
      this.ui.elements.replayButton.disabled = true;
    });

    this.socket.io.on('reconnect_attempt', () => {
      this.ui.setStatus('서버 재연결 중...');
    });

    this.socket.io.on('reconnect', () => {
      this.ui.setStatus('서버 재연결 완료');
    });
  }

  handleGameState(gameState) {
    const prevState = this.state.game;
    const prevPlayers = buildPlayerMap(prevState?.players);

    this.state.game = gameState;
    const nextPhase = gameState?.phase;
    const prevPhase = prevState?.phase;
    const audio = this.audio;
    if (audio) {
      if (nextPhase === 'countdown' && typeof audio.playCountdownTick === 'function') {
        const previousCountdown = typeof prevState?.countdown === 'number' ? prevState.countdown : null;
        const currentCountdown = typeof gameState?.countdown === 'number' ? gameState.countdown : null;
        const enteringCountdown = prevPhase !== 'countdown';
        const countdownDecreased =
          prevPhase === 'countdown' &&
          previousCountdown !== null &&
          currentCountdown !== null &&
          currentCountdown < previousCountdown;
        if (currentCountdown !== null && currentCountdown > 0 && (enteringCountdown || countdownDecreased)) {
          audio.playCountdownTick();
        }
      }
      if (nextPhase === 'running' && prevPhase !== 'running' && typeof audio.playMatchStart === 'function') {
        audio.playMatchStart();
      }
    }
    this.updateSpectatorState(gameState);
    this.ui.handleGamePhase();
    this.ui.updateHud();

    if (prevState && gameState.round !== prevState.round && gameState.phase === 'running') {
      const favorites = this.state.highlights?.favorites || [];
      const filters = this.state.highlights?.filters || { query: '', tags: [] };
      const importReports = this.state.highlights?.importReports || [];
      this.state.highlights = buildHighlightState({ favorites, filters, importReports });
      this.ui.renderHighlights();
      this.state.achievements = [];
      this.ui.renderAchievements();
    }

    if (this.state.playerId) {
      const me = gameState.players?.find((p) => p.id === this.state.playerId);
      if (me) {
        const previousMe = prevPlayers.get(me.id);
        if (previousMe) {
          if (me.score > previousMe.score) {
            const head = me.segments?.[0];
            if (head) this.renderer.addParticleBurst({ x: head.x, y: head.y, color: me.color, count: 12 });
            this.audio.playFood();
          }
          if (previousMe.alive && !me.alive) {
            const head = previousMe.segments?.[0] || me.segments?.[0];
            if (head) {
              this.renderer.addParticleBurst({
                x: head.x,
                y: head.y,
                color: '#ff4d4f',
                count: 26,
                speed: 180,
                life: 600
              });
            }
            if (this.state.personal.alive) {
              this.audio.playDeath();
              this.ui.notify('탈락했습니다. 관전 모드!', 'warn');
            }
          }
          this.emitEffectBursts(me, previousMe, { isLocal: true });
        }
        this.state.personal.lastScore = me.score;
        this.state.personal.alive = me.alive;
      }
    }

    gameState.players?.forEach((player) => {
      if (player.id === this.state.playerId) return;
      const previous = prevPlayers.get(player.id);
      if (!previous) return;
      const head = player.segments?.[0] || previous.segments?.[0];
      if (!head) return;
      if (player.score > previous.score) {
        this.renderer.addParticleBurst({ x: head.x, y: head.y, color: player.color, count: 8 });
      }
      if (previous.alive && !player.alive) {
        this.renderer.addParticleBurst({ x: head.x, y: head.y, color: '#fa541c', count: 20, speed: 200 });
      }
      this.emitEffectBursts(player, previous, { isLocal: false });
    });

    this.state.lastState = gameState;
  }

  emitEffectBursts(current, previous, { isLocal = false } = {}) {
    const before = new Set(previous?.effects || []);
    const after = new Set(current?.effects || []);
    const head = current?.segments?.[0] || previous?.segments?.[0];
    if (!head) return;

    after.forEach((effect) => {
      if (before.has(effect)) return;
      this.renderer.addParticleBurst({
        x: head.x,
        y: head.y,
        color: EFFECT_COLORS[effect] || current.color,
        count: 10,
        speed: 140
      });
      if (isLocal && typeof this.audio?.startEffectLoop === 'function') {
        this.audio.startEffectLoop(effect);
      } else if (!isLocal && typeof this.audio?.playPowerupStart === 'function') {
        this.audio.playPowerupStart(effect, { scope: 'remote' });
      }
    });

    before.forEach((effect) => {
      if (after.has(effect)) return;
      if (isLocal && typeof this.audio?.stopEffectLoop === 'function') {
        this.audio.stopEffectLoop(effect, { playTail: true });
      } else if (!isLocal && typeof this.audio?.playPowerupEnd === 'function') {
        this.audio.playPowerupEnd(effect, { scope: 'remote' });
      }
    });
  }

  updateSpectatorState(gameState) {
    const spectator = this.state.spectator;
    if (!spectator) return;

    const previousFocus = spectator.focusId;
    const players = Array.isArray(gameState?.players) ? gameState.players : [];
    const leaderboard = Array.isArray(gameState?.leaderboard) ? gameState.leaderboard : [];
    const alivePlayers = players.filter((player) => player.alive);
    const focusCandidates = leaderboard.length
      ? leaderboard.filter((entry) => alivePlayers.find((player) => player.id === entry.id))
      : alivePlayers;

    const me = players.find((player) => player.id === this.state.playerId) || null;
    if (!players.length) {
      spectator.active = false;
      spectator.focusId = null;
      spectator.cameraIds = [];
      return;
    }

    spectator.active = (!me || !me.alive) && alivePlayers.length > 0;
    if (!spectator.active) {
      spectator.focusId = null;
      spectator.cameraIds = [];
      return;
    }

    const candidateIds = focusCandidates.map((entry) => entry.id);
    if (!spectator.focusId || !candidateIds.includes(spectator.focusId)) {
      const fallback = alivePlayers.find((player) => candidateIds.includes(player.id)) || alivePlayers[0];
      spectator.focusId = fallback?.id || null;
    }

    const maxCameras = spectator.maxCameras || 3;
    const unique = (list) => {
      const seen = new Set();
      return list.filter((value) => {
        if (!value) return false;
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    };

    const nextCameraOrder = spectator.locked
      ? unique(spectator.cameraIds.filter((id) => candidateIds.includes(id)))
      : unique([spectator.focusId, ...candidateIds]);

    if (!spectator.locked) {
      spectator.cameraIds = nextCameraOrder.slice(0, maxCameras);
    } else {
      const ensured = unique([spectator.focusId, ...nextCameraOrder]);
      if (ensured.length) {
        spectator.cameraIds = ensured.slice(0, maxCameras);
      } else {
        spectator.cameraIds = spectator.focusId ? [spectator.focusId] : [];
      }
    }

    if (
      spectator.active &&
      spectator.focusId &&
      spectator.focusId !== previousFocus &&
      typeof this.audio?.playSpectatorFocus === 'function'
    ) {
      this.audio.playSpectatorFocus({ subtle: true });
    }
  }
}
