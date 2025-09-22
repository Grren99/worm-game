export const TICK_RATE = 20;

export const PLAYER_COLORS = {
  '#ff4d4f': '🔥',
  '#40a9ff': '❄️',
  '#52c41a': '🌿',
  '#faad14': '⚡',
  '#9254de': '🔮',
  '#fa541c': '🌋',
  '#eb2f96': '🌸',
  '#13c2c2': '💎'
};

export const PLAYER_COLOR_KEYS = Object.keys(PLAYER_COLORS);

export const GAME_MODES = [
  { key: 'classic', label: '클래식 모드', description: '표준 규격의 밸런스 모드' },
  { key: 'battle', label: '배틀 모드', description: '파워업과 음식이 풍부한 전투 중심 모드' },
  { key: 'speed', label: '스피드 모드', description: '빠른 이동 속도로 승부를 보는 모드' },
  { key: 'tournament', label: '토너먼트 모드', description: '여러 라운드를 거쳐 최종 우승자를 결정하는 모드' }
];

export const MODE_MAP = new Map(GAME_MODES.map((mode) => [mode.key, mode]));

export const PHASE_LABEL = {
  waiting: '대기',
  countdown: '카운트다운',
  running: '진행',
  ended: '종료',
  intermission: '라운드 대기'
};

export const POWERUP_LABEL = {
  speed: '속도 증가',
  shield: '무적',
  shrink: '작아지기'
};

export const POWERUP_ICON = {
  speed: '⚡',
  shield: '🛡',
  shrink: '🌀'
};

export const initialState = () => ({
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
});

export const state = initialState();
