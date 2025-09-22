import { MODE_MAP, PLAYER_COLOR_KEYS } from './state.js';

const buildPlayerMap = (players = []) => {
  const map = new Map();
  players.forEach((player) => {
    map.set(player.id, player);
  });
  return map;
};

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
      if (this.state.audioEnabled) this.audio.playBgm();
    });

    this.socket.on('player:profile', (profile) => {
      this.state.personal.profile = profile || null;
      this.ui.renderPlayerProfile();
    });

    this.socket.on('game:state', (gameState) => {
      this.handleGameState(gameState);
    });

    this.socket.on('game:ended', ({ winnerId, leaderboard, tournament }) => {
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
    });

    this.socket.on('chat:message', (message) => {
      this.state.chat.push(message);
      this.state.chat = this.state.chat.slice(-80);
      this.ui.renderChat();
    });

    this.socket.on('room:notification', (note) => {
      this.ui.notify(note.message, note.type || 'info');
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
    this.ui.handleGamePhase();
    this.ui.updateHud();

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
          this.emitEffectBursts(me, previousMe);
        }
        this.state.personal.lastScore = me.score;
        this.state.personal.alive = me.alive;
      }
    }

    gameState.players?.forEach((player) => {
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
      this.emitEffectBursts(player, previous);
    });

    this.state.lastState = gameState;
  }

  emitEffectBursts(current, previous) {
    const before = new Set(previous?.effects || []);
    const head = current.segments?.[0] || previous?.segments?.[0];
    if (!head) return;
    (current.effects || []).forEach((effect) => {
      if (before.has(effect)) return;
      this.renderer.addParticleBurst({
        x: head.x,
        y: head.y,
        color: EFFECT_COLORS[effect] || current.color,
        count: 10,
        speed: 140
      });
    });
  }
}
