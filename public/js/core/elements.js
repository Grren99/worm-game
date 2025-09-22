export const elements = {
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
  highlightSummary: document.getElementById('highlight-summary'),
  highlightList: document.getElementById('tournament-highlights'),
  favoriteHighlightList: document.getElementById('favorite-highlights'),
  clearHighlightFavorites: document.getElementById('clear-highlight-favorites'),
  highlightSearch: document.getElementById('highlight-search'),
  highlightTagFilters: document.getElementById('highlight-tag-filters'),
  highlightImportButton: document.getElementById('highlight-import-button'),
  highlightImportInput: document.getElementById('highlight-import-input'),
  achievementList: document.getElementById('achievement-list'),
  modeIndicator: document.getElementById('mode-indicator'),
  worldInfo: document.getElementById('world-info'),
  overlay: document.getElementById('game-overlay'),
  countdown: document.getElementById('countdown'),
  canvas: document.getElementById('game-canvas'),
  mobileControls: document.getElementById('mobile-controls'),
  mobileStick: document.getElementById('mobile-stick'),
  mobileStickHandle: document.getElementById('mobile-stick-handle')
};

elements.colorButtons = [...(elements.colorPalette?.querySelectorAll('button') || [])];

elements.highlightTagButtons = [
  ...(elements.highlightTagFilters?.querySelectorAll('button[data-tag]') || [])
];

elements.canvasContext = elements.canvas?.getContext('2d') || null;

elements.replayContext = elements.replayCanvas?.getContext('2d') || null;
