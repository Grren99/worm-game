import {
  GAME_MODES,
  MODE_MAP,
  PHASE_LABEL,
  PLAYER_COLORS,
  PLAYER_COLOR_KEYS,
  POWERUP_ICON,
  POWERUP_LABEL
} from './state.js';
import { recommendClips } from './highlightRecommender.js';
import { validateHighlightClip } from './highlightValidator.js';

const ROOM_PHASE_LABEL = {
  waiting: '대기중',
  countdown: '시작 대기',
  running: '진행중',
  intermission: '인터미션',
  ended: '종료'
};

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] || char);

const HIGHLIGHT_TAG_LABELS = new Map([
  ['kill', '킬'],
  ['combat', '전투'],
  ['collision', '충돌'],
  ['first-kill', '퍼스트 킬'],
  ['powerup', '파워업'],
  ['powerup:speed', '파워업: 속도'],
  ['powerup:shield', '파워업: 무적'],
  ['powerup:shrink', '파워업: 축소'],
  ['golden', '골든 음식'],
  ['food', '먹이'],
  ['growth', '성장'],
  ['round-end', '라운드'],
  ['summary', '라운드 요약'],
  ['victory', '승리'],
  ['draw', '무승부'],
  ['my-play', '내 플레이'],
  ['my-death', '내 탈락'],
  ['my-win', '내 승리']
]);

export class UIManager {
  constructor({ state, elements, socket, audio, highlightLibrary }) {
    this.state = state;
    this.elements = elements;
    this.socket = socket;
    this.audio = audio;
    this.highlightLibrary = highlightLibrary || null;
    this.statsInterval = null;
  }

  init() {
    this.populateModeOptions();
    this.renderColorPalette();
    this.updateModeIndicator();
    this.attachEventListeners();
    this.restoreHighlightFavorites();
    this.renderHighlights();
    this.renderAchievements();
    this.fetchStats();
    this.statsInterval = setInterval(() => this.fetchStats(), 60000);
    this.notify('온라인 지렁이 배틀에 오신 것을 환영합니다!');
  }

  dispose() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }

  setStatus(text, error = false) {
    this.elements.status.textContent = text;
    this.elements.status.classList.toggle('status--error', error);
  }

  notify(message, type = 'info') {
    const entry = {
      id: crypto.randomUUID(),
      message,
      type,
      timestamp: Date.now()
    };
    this.state.notifications.unshift(entry);
    this.state.notifications = this.state.notifications.slice(0, 20);
    this.renderNotifications();
  }

  renderNotifications() {
    this.elements.notificationList.innerHTML = this.state.notifications
      .map(
        (note) => `
        <li data-type="${note.type}">
          <strong>${this.formatTime(note.timestamp)}</strong>
          <div>${note.message}</div>
        </li>`
      )
      .join('');
  }

  populateModeOptions() {
    if (!this.elements.modeSelect) return;
    this.elements.modeSelect.innerHTML = GAME_MODES.map(
      (mode) => `<option value="${mode.key}">${mode.label}</option>`
    ).join('');
    if (!MODE_MAP.has(this.state.preferences.mode)) {
      this.state.preferences.mode = GAME_MODES[0].key;
    }
    this.elements.modeSelect.value = this.state.preferences.mode;
    this.updateModeDescription();
  }

  updateModeDescription() {
    if (!this.elements.modeDescription) return;
    const mode = MODE_MAP.get(this.state.preferences.mode) || GAME_MODES[0];
    this.elements.modeDescription.textContent = mode.description;
  }

  updateModeIndicator() {
    if (!this.elements.modeIndicator) return;
    const modeInfo = this.state.game?.mode;
    if (!modeInfo) {
      this.elements.modeIndicator.textContent = '모드: 로비';
      return;
    }
    const phaseLabel = PHASE_LABEL[this.state.game?.phase] || '대기';
    this.elements.modeIndicator.textContent = `모드: ${modeInfo.label} · ${phaseLabel}`;
  }

  renderColorPalette() {
    if (!this.elements.colorButtons?.length) return;
    this.elements.colorButtons.forEach((button) => {
      const color = button.dataset.color;
      if (!color) return;
      button.style.setProperty('--picker-color', color);
      const selected = color === this.state.preferences.color;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (this.elements.colorPreview) {
      this.elements.colorPreview.style.setProperty('--preview-color', this.state.preferences.color);
      const badge = PLAYER_COLORS[this.state.preferences.color] || '';
      const label = badge ? `${badge} ${this.state.preferences.color}` : this.state.preferences.color;
      this.elements.colorPreview.textContent = `선택 색상: ${label}`;
    }
  }

  applyPreferredColor(color, { attemptChange = false } = {}) {
    if (!PLAYER_COLOR_KEYS.includes(color)) return;
    const previous = this.state.preferences.color;
    this.state.preferences.color = color;
    this.renderColorPalette();
    if (!attemptChange || !this.state.playerId) return;
    this.socket.emit('player:color-change', { playerId: this.state.playerId, color }, (response = {}) => {
      if (response.error) {
        this.notify(response.error, 'warn');
        this.state.preferences.color = previous;
        this.renderColorPalette();
        return;
      }
      if (response.color) {
        this.state.preferences.color = response.color;
        this.renderColorPalette();
      }
    });
  }

  renderRooms() {
    if (!this.state.rooms.length) {
      this.elements.roomList.classList.add('empty');
      this.elements.roomList.innerHTML = '<li>참여 가능한 방이 없습니다.</li>';
      return;
    }
    this.elements.roomList.classList.remove('empty');
    this.elements.roomList.innerHTML = this.state.rooms
      .map((room) => {
        const phaseText = ROOM_PHASE_LABEL[room.phase] || '진행중';
        const modeLabel = room.mode?.label || '모드 미정';
        return `
        <li>
          <div>
            <div><strong>${room.name}</strong></div>
            <div class="sub">${room.id} · ${room.players}명 · ${modeLabel} · ${phaseText}</div>
          </div>
          <button class="btn btn--primary" data-room="${room.id}">입장</button>
        </li>`;
      })
      .join('');
    this.elements.roomList.querySelectorAll('button[data-room]').forEach((button) => {
      button.addEventListener('click', async () => {
        const roomId = button.dataset.room;
        const playerName = this.getPlayerName();
        await this.requestJoin('room:join', {
          roomId,
          playerName,
          preferredColor: this.state.preferences.color
        });
      });
    });
  }

  async fetchStats() {
    try {
      this.elements.statsUpdated.textContent = '업데이트 중...';
      const response = await fetch('/api/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      const rows = data.players
        .map(
          (player) => `
        <tr>
          <td>${player.name}</td>
          <td>${player.winRate}%</td>
          <td>${player.averageScore}</td>
          <td>${player.averageSurvivalSeconds}s</td>
        </tr>`
        )
        .join('');
      this.elements.statsTableBody.innerHTML = rows || '<tr><td colspan="4" class="empty">데이터가 없습니다</td></tr>';
      this.elements.statsUpdated.textContent = `업데이트: ${this.formatTime(data.updatedAt)}`;
    } catch (error) {
      this.elements.statsTableBody.innerHTML = '<tr><td colspan="4" class="empty">통계를 불러오지 못했습니다</td></tr>';
      this.elements.statsUpdated.textContent = '업데이트 실패';
    }
  }

  getPlayerName() {
    const raw = this.elements.nameInput.value.trim();
    return raw ? raw.slice(0, 16) : 'Player';
  }

  async requestJoin(action, data) {
    return new Promise((resolve) => {
      this.socket.emit(action, data, (response) => {
        if (response?.error) {
          this.joinRoomCallback(response.error, null);
          resolve(false);
        } else {
          this.joinRoomCallback(null, response);
          resolve(true);
        }
      });
    });
  }

  joinRoomCallback(error, payload) {
    if (error) {
      this.notify(error, 'error');
      this.setStatus(error, true);
      return;
    }
    this.setStatus(`${payload.name} 방에 입장했습니다.`);
  }

  updateScoreboard() {
    const leaderboard = this.state.game?.leaderboard || [];
    if (!leaderboard.length) {
      this.elements.scoreboardBody.innerHTML = '<tr><td colspan="3" class="empty">대기 중</td></tr>';
      return;
    }
    this.elements.scoreboardBody.innerHTML = leaderboard
      .map((entry) => {
        const highlight = entry.id === this.state.playerId ? ' style="color: var(--accent); font-weight:600"' : '';
        return `
        <tr${highlight}>
          <td>${entry.name}${entry.alive ? '' : ' 💀'}</td>
          <td>${entry.score}</td>
          <td>${entry.kills}</td>
        </tr>`;
      })
      .join('');
  }

  updateAliveList() {
    const players = this.state.game?.players || [];
    const alive = players.filter((p) => p.alive);
    this.elements.aliveList.innerHTML = alive
      .map((p) => `<li style="background:${p.color}1f;border:1px solid ${p.color}4d">${p.name}</li>`)
      .join('');
  }

  renderPlayerProfile() {
    const container = this.elements.playerProfile;
    if (!container) return;
    const profile = this.state.personal.profile;
    if (!this.state.playerId || !profile) {
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
  }

  updatePlayerStatus() {
    if (!this.state.playerId) {
      this.elements.playerStatus.textContent = '대기 중';
      this.elements.effectsList.innerHTML = '';
      this.renderPlayerProfile();
      return;
    }
    const me = this.state.game?.players?.find((p) => p.id === this.state.playerId);
    if (!me) {
      this.elements.playerStatus.textContent = '관전 중';
      this.elements.effectsList.innerHTML = '';
      this.renderPlayerProfile();
      return;
    }
    this.elements.playerStatus.textContent = me.alive ? '전투 중' : '탈락 (관전 가능)';
    this.elements.effectsList.innerHTML = (me.effects || [])
      .map((effect) => `<li>${POWERUP_ICON[effect] || '✨'} ${POWERUP_LABEL[effect] || effect}</li>`)
      .join('');
    this.renderPlayerProfile();
  }

  updateTournamentStatus() {
    const container = this.elements.tournamentSection;
    if (!container) return;
    const tournament = this.state.game?.tournament;
    if (!tournament?.enabled) {
      container.classList.add('is-hidden');
      if (this.elements.tournamentWins) this.elements.tournamentWins.innerHTML = '';
      if (this.elements.tournamentRounds) this.elements.tournamentRounds.textContent = '토너먼트 미진행';
      if (this.elements.tournamentTimer) this.elements.tournamentTimer.textContent = '';
      return;
    }
    container.classList.remove('is-hidden');
    const currentRound = tournament.currentRound || 0;
    if (this.elements.tournamentRounds) {
      this.elements.tournamentRounds.textContent = `목표 ${tournament.roundsToWin}승 · 현재 라운드 ${currentRound}`;
    }
    if (this.elements.tournamentTimer) {
      const timerText = tournament.championId
        ? '토너먼트 종료'
        : tournament.intermissionRemaining
        ? `다음 라운드까지 ${tournament.intermissionRemaining}s`
        : '';
      this.elements.tournamentTimer.textContent = timerText;
    }
    if (this.elements.tournamentWins) {
      const winsMarkup = (tournament.wins || [])
        .map((entry) => {
          const championClass = tournament.championId === entry.playerId ? ' class="champion"' : '';
          return `<li${championClass} style="border-left: 4px solid ${entry.color}"><strong>${entry.name}</strong><span>${entry.wins}승</span></li>`;
        })
        .join('');
      this.elements.tournamentWins.innerHTML = winsMarkup || '<li class="empty">아직 승자가 없습니다</li>';
    }
  }

  updateCountdown() {
    if (!this.state.game) {
      this.elements.countdown.classList.remove('active');
      return;
    }
    if (this.state.game.phase === 'countdown' && this.state.game.countdown >= 0) {
      this.elements.countdown.textContent = `시작까지 ${this.state.game.countdown}s`;
      this.elements.countdown.classList.add('active');
    } else if (this.state.game.phase === 'intermission' && this.state.game.intermission > 0) {
      this.elements.countdown.textContent = `다음 라운드까지 ${this.state.game.intermission}s`;
      this.elements.countdown.classList.add('active');
    } else {
      this.elements.countdown.classList.remove('active');
    }
  }

  updateHud() {
    this.updateScoreboard();
    this.updateAliveList();
    this.updatePlayerStatus();
    this.updateTournamentStatus();
    this.updateModeIndicator();
    this.updateCountdown();
  }

  setOverlay(text) {
    if (!text) {
      this.elements.overlay.classList.add('hidden');
      this.elements.overlay.textContent = '';
      return;
    }
    this.elements.overlay.textContent = text;
    this.elements.overlay.classList.remove('hidden');
  }

  handleGamePhase() {
    if (!this.state.game) {
      this.setOverlay('게임에 참가하여 전투를 시작하세요!');
      return;
    }
    switch (this.state.game.phase) {
      case 'waiting':
        this.setOverlay('플레이어 대기 중... 최소 2명 필요');
        break;
      case 'countdown':
        this.setOverlay(null);
        break;
      case 'running':
        this.setOverlay(null);
        break;
      case 'intermission': {
        const seconds = this.state.game.intermission || 0;
        this.setOverlay(`다음 라운드를 준비 중... ${seconds}s`);
        break;
      }
      case 'ended': {
        const winner = this.state.game.leaderboard?.[0];
        this.setOverlay(winner ? `${winner.name}님의 승리!` : '무승부!');
        break;
      }
      default:
        this.setOverlay(null);
    }
  }

  renderChat() {
    this.elements.chatLog.innerHTML = this.state.chat
      .map(
        (msg) => `
      <div class="chat__message">
        <div class="chat__author" style="color:${msg.color}">${msg.author}</div>
        <div class="chat__text">${msg.message}</div>
        <div class="chat__timestamp">${this.formatTime(msg.timestamp)}</div>
      </div>`
      )
      .join('');
    this.elements.chatLog.scrollTop = this.elements.chatLog.scrollHeight;
  }

  restoreHighlightFavorites() {
    if (this.highlightLibrary) {
      this.state.highlights.favorites = this.highlightLibrary.list();
    } else {
      this.state.highlights.favorites = [];
    }
    this.renderFavoriteHighlights();
  }

  syncHighlightFavorites() {
    if (this.highlightLibrary) {
      this.state.highlights.favorites = this.highlightLibrary.list();
    } else {
      this.state.highlights.favorites = [];
    }
    this.renderFavoriteHighlights();
  }

  getClipById(id) {
    if (!id) return null;
    const clips = this.state.highlights?.clips || [];
    const clip = clips.find((entry) => entry.id === id);
    if (clip) return clip;
    return this.highlightLibrary?.get(id) || null;
  }

  getHighlightFilters() {
    if (!this.state.highlights.filters || typeof this.state.highlights.filters !== 'object') {
      this.state.highlights.filters = { query: '', tags: [] };
    }
    if (!Array.isArray(this.state.highlights.filters.tags)) {
      this.state.highlights.filters.tags = [];
    }
    return this.state.highlights.filters;
  }

  renderHighlightFilters() {
    const filters = this.getHighlightFilters();
    if (this.elements.highlightSearch) {
      this.elements.highlightSearch.value = filters.query || '';
    }
    if (Array.isArray(this.elements.highlightTagButtons)) {
      this.elements.highlightTagButtons.forEach((button) => {
        const tag = button.dataset.tag;
        const active = filters.tags.includes(tag);
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
  }

  updateHighlightSearch(query) {
    const filters = this.getHighlightFilters();
    filters.query = (query || '').trim();
    this.renderHighlights();
  }

  toggleHighlightTag(tag) {
    if (!tag) return;
    const filters = this.getHighlightFilters();
    const index = filters.tags.indexOf(tag);
    if (index >= 0) {
      filters.tags.splice(index, 1);
    } else {
      filters.tags.push(tag);
    }
    this.renderHighlightFilters();
    this.renderHighlights();
  }

  buildClipTags(clip) {
    const tags = new Set();
    const push = (value) => {
      if (!value) return;
      const normalized = String(value).trim().toLowerCase();
      if (normalized) tags.add(normalized);
    };
    if (Array.isArray(clip?.tags)) {
      clip.tags.forEach(push);
    }
    const meta = clip?.meta || {};
    const type = String(clip?.type || '').toLowerCase();
    switch (type) {
      case 'kill':
        push('kill');
        push('combat');
        if (meta.cause) push(meta.cause);
        if (meta.killerId === this.state.playerId) push('my-play');
        if (meta.victimId === this.state.playerId) push('my-death');
        break;
      case 'powerup':
        push('powerup');
        if (meta.powerup) push(`powerup:${meta.powerup}`);
        if (meta.playerId === this.state.playerId) push('my-play');
        break;
      case 'golden-food':
        push('golden');
        push('food');
        push('growth');
        if (meta.playerId === this.state.playerId) push('my-play');
        break;
      case 'round-end':
        push('round-end');
        push('summary');
        if (meta.winnerId) push('victory');
        if (!meta.winnerId) push('draw');
        if (meta.winnerId === this.state.playerId) push('my-win');
        break;
      default:
        break;
    }
    if (meta.powerup) {
      push('powerup');
      push(`powerup:${meta.powerup}`);
    }
    return [...tags].filter((tag) => tag && tag !== 'highlight');
  }

  formatHighlightTag(tag) {
    if (!tag) return '';
    if (HIGHLIGHT_TAG_LABELS.has(tag)) {
      return HIGHLIGHT_TAG_LABELS.get(tag);
    }
    if (tag.startsWith('powerup:')) {
      const [, type] = tag.split(':');
      if (type) {
        const label = HIGHLIGHT_TAG_LABELS.get(`powerup:${type}`);
        return label || `파워업: ${type.toUpperCase()}`;
      }
      return '파워업';
    }
    return tag.replace(/-/g, ' ');
  }

  renderClipTags(clip) {
    const tags = this.buildClipTags(clip);
    if (!tags.length) return '';
    const badges = tags
      .map((tag) => {
        const label = escapeHtml(this.formatHighlightTag(tag));
        return `<span class="highlight-tag" data-tag="${tag}">${label}</span>`;
      })
      .join('');
    return `<div class="highlight-card__tags">${badges}</div>`;
  }

  buildClipSearchText(clip) {
    const meta = clip?.meta || {};
    const parts = [clip?.title, clip?.subtitle];
    const names = [meta.killerName, meta.victimName, meta.playerName, meta.winnerName];
    names.forEach((value) => {
      if (value) parts.push(value);
    });
    return parts
      .filter(Boolean)
      .map((value) => String(value).toLowerCase())
      .join(' ');
  }

  clipMatchesFilters(clip, filters = this.getHighlightFilters()) {
    if (!clip) return false;
    const tags = this.buildClipTags(clip);
    if (filters.tags.length) {
      const missing = filters.tags.some((tag) => !tags.includes(tag));
      if (missing) return false;
    }
    const query = (filters.query || '').trim().toLowerCase();
    if (query) {
      const haystack = this.buildClipSearchText(clip);
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  collectFilteredHighlightEntries(clips = []) {
    const filters = this.getHighlightFilters();
    const results = [];
    clips.forEach((clip, index) => {
      if (this.clipMatchesFilters(clip, filters)) {
        results.push({ clip, index });
      }
    });
    return results;
  }

  filterFavoriteClips(favorites = []) {
    const filters = this.getHighlightFilters();
    return favorites.filter((clip) => this.clipMatchesFilters(clip, filters));
  }

  async handleHighlightImport(file) {
    if (!file) return;
    if (!this.highlightLibrary) {
      this.notify('즐겨찾기 저장소를 사용할 수 없습니다.', 'warn');
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const rawClip = data?.clip ? { ...data.clip } : { ...data };
      const validation = validateHighlightClip({ clip: rawClip, sourceName: file.name });
      const reportBase = {
        id: crypto.randomUUID(),
        status: 'success',
        fileName: file.name || null,
        importedAt: Date.now(),
        clipTitle: validation.clip?.title || rawClip?.title || '하이라이트',
        warnings: validation.warnings,
        errors: validation.errors,
        stats: validation.stats
      };

      if (validation.errors.length || !validation.clip) {
        reportBase.status = 'error';
        const reason = validation.errors[0] || '하이라이트를 가져오지 못했습니다.';
        reportBase.message = `${reportBase.clipTitle || '하이라이트'} · ${reason}`;
        this.pushHighlightImportReport(reportBase);
        this.notify(`하이라이트 임포트 실패: ${reason}`, 'error');
        return;
      }

      const clip = validation.clip;
      clip.id = clip.id || `import-${crypto.randomUUID()}`;
      clip.timestamp = clip.timestamp || Date.now();
      if (!Array.isArray(clip.tags) || !clip.tags.length) {
        clip.tags = this.buildClipTags(clip);
      }

      this.highlightLibrary.add(clip);
      this.syncHighlightFavorites();
      this.renderHighlights();

      const clipTitle = reportBase.clipTitle || '하이라이트';
      if (validation.warnings.length) {
        this.notify(`임포트 경고: ${validation.warnings[0]}`, 'warn');
        reportBase.status = 'warning';
        reportBase.message = `${clipTitle} · 경고 ${validation.warnings.length}건과 함께 저장되었습니다.`;
      } else {
        reportBase.status = 'success';
        reportBase.message = `${clipTitle} · 즐겨찾기에 저장되었습니다.`;
      }

      this.notify('하이라이트 JSON을 가져와 즐겨찾기에 저장했습니다.', 'success');
      this.pushHighlightImportReport(reportBase);
    } catch (error) {
      console.error('Failed to import highlight clip', error);
      this.notify('JSON 하이라이트를 불러오지 못했습니다.', 'error');
      const failedReport = {
        id: crypto.randomUUID(),
        status: 'error',
        message: `${file?.name || '파일'} · JSON 파싱 실패`,
        fileName: file?.name || null,
        importedAt: Date.now(),
        errors: ['JSON 파싱 실패'],
        warnings: [],
        stats: null
      };
      this.pushHighlightImportReport(failedReport);
    }
  }

  renderHighlights() {
    if (!this.elements.highlightList || !this.elements.highlightSummary) return;
    const data = this.state.highlights || {};
    const clips = Array.isArray(data.clips) ? data.clips : [];
    const summary = data.summary || null;
    const favoriteClips = Array.isArray(this.state.highlights?.favorites)
      ? this.state.highlights.favorites
      : [];
    const favoriteIds = new Set(favoriteClips.map((entry) => entry.id));

    this.renderHighlightFilters();
    this.renderFavoriteHighlights();
    this.renderHighlightImportReport();

    if (!summary) {
      this.elements.highlightSummary.textContent = '하이라이트 데이터를 기다리는 중...';
    } else {
      const lines = [];
      if (summary.winnerName) {
        lines.push(`우승: ${summary.winnerName}`);
      }
      if (summary.topKiller) {
        lines.push(`최다 킬: ${summary.topKiller.name} ${summary.topKiller.kills}회`);
      }
      if (summary.goldenCollector) {
        lines.push(`골든 수집: ${summary.goldenCollector.name} ${summary.goldenCollector.golden}개`);
      }
      if (summary.survivor) {
        lines.push(`생존: ${summary.survivor.name} ${summary.survivor.survivalSeconds}s`);
      }
      this.elements.highlightSummary.textContent = lines.length
        ? lines.join(' · ')
        : '이번 라운드에서 특이사항이 없습니다.';
    }

    const recommendationEntries = clips.map((clip, index) => ({ clip, index }));
    const recommendations = recommendClips(recommendationEntries, {
      limit: 3,
      favorites: favoriteIds,
      playerId: this.state.playerId,
      preferredTags: this.getHighlightFilters().tags,
      stats: Array.isArray(data.stats) ? data.stats : []
    });
    this.state.highlights.recommendations = recommendations;
    this.renderHighlightRecommendations(recommendations, favoriteIds);

    if (!clips.length) {
      this.elements.highlightList.innerHTML = '<li class="empty">하이라이트가 준비되면 여기에 표시됩니다.</li>';
      return;
    }

    const entries = this.collectFilteredHighlightEntries(clips);
    if (!entries.length) {
      this.elements.highlightList.innerHTML = '<li class="empty">선택한 필터와 일치하는 하이라이트가 없습니다.</li>';
      return;
    }

    this.elements.highlightList.innerHTML = entries
      .map(({ clip, index }) => {
        const isFavorite = favoriteIds.has(clip.id);
        return `
        <li>
          <div class="highlight-card" data-highlight-id="${clip.id}">
            <button type="button" class="highlight-card__body" data-action="play" data-index="${index}">
              <span class="title">${clip.title || '하이라이트'}</span>
              <span class="subtitle">${clip.subtitle || ''}</span>
              ${this.renderClipTags(clip)}
            </button>
            <div class="highlight-card__actions">
              <button
                type="button"
                class="highlight-card__action highlight-card__action--favorite${isFavorite ? ' is-active' : ''}"
                data-action="favorite"
                data-highlight-id="${clip.id}"
                aria-pressed="${isFavorite ? 'true' : 'false'}"
                title="${isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}"
              >${isFavorite ? '★' : '☆'}</button>
              <button
                type="button"
                class="highlight-card__action"
                data-action="share"
                data-highlight-id="${clip.id}"
                title="클립 정보 공유"
              >🔗</button>
              <button
                type="button"
                class="highlight-card__action"
                data-action="export"
                data-highlight-id="${clip.id}"
                title="클립 JSON 다운로드"
              >⬇️</button>
            </div>
          </div>
        </li>`;
      })
      .join('');

    this.elements.highlightList.querySelectorAll('[data-action="play"]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.index, 10);
        if (Number.isNaN(index)) {
          this.notify('하이라이트를 찾을 수 없습니다.', 'warn');
          return;
        }
        const clip = (this.state.highlights?.clips || [])[index];
        this.playHighlightClip(clip);
      });
    });

    this.elements.highlightList.querySelectorAll('[data-action="favorite"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.toggleHighlightFavorite(id);
      });
    });

    this.elements.highlightList.querySelectorAll('[data-action="share"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.shareHighlightClip(id);
      });
    });

    this.elements.highlightList.querySelectorAll('[data-action="export"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.exportHighlightClip(id);
      });
    });

    this.elements.highlightList.querySelectorAll('.highlight-tag').forEach((tagButton) => {
      tagButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.toggleHighlightTag(tagButton.dataset.tag);
      });
    });
  }

  renderHighlightRecommendations(recommendations = [], favoriteIds = new Set()) {
    const container = this.elements.highlightRecommendations;
    const list = this.elements.highlightRecommendationList;
    if (!container || !list) return;
    if (!Array.isArray(recommendations) || !recommendations.length) {
      list.innerHTML = '<li class="empty">추천을 준비하는 중...</li>';
      return;
    }
    list.innerHTML = recommendations
      .map((entry) => {
        const clip = entry.clip;
        const isFavorite = favoriteIds.has(clip.id);
        const favoriteLabel = isFavorite ? '즐겨찾기 해제' : '즐겨찾기';
        const favoriteIcon = isFavorite ? '★' : '☆';
        return `
        <li>
          <div class="highlight-recommendation" data-highlight-id="${clip.id}">
            <div class="highlight-recommendation__header">
              <span class="highlight-recommendation__badge">추천</span>
              <strong>${clip.title || '하이라이트'}</strong>
              <span class="highlight-recommendation__score">점수 ${entry.score}</span>
            </div>
            <p class="highlight-recommendation__reason">${entry.reason || '최근 경기 기반 추천 클립입니다.'}</p>
            ${this.renderClipTags(clip)}
            <div class="highlight-recommendation__actions">
              <button type="button" data-action="play" data-index="${entry.index}">재생</button>
              <button type="button" data-action="favorite" data-highlight-id="${clip.id}">
                ${favoriteIcon} ${favoriteLabel}
              </button>
            </div>
          </div>
        </li>`;
      })
      .join('');

    list.querySelectorAll('[data-action="play"]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.index, 10);
        if (Number.isNaN(index)) {
          this.notify('추천 하이라이트를 찾을 수 없습니다.', 'warn');
          return;
        }
        this.playHighlightClip(index);
      });
    });

    list.querySelectorAll('[data-action="favorite"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.toggleHighlightFavorite(id);
      });
    });

    list.querySelectorAll('.highlight-tag').forEach((tagButton) => {
      tagButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.toggleHighlightTag(tagButton.dataset.tag);
      });
    });
  }

  pushHighlightImportReport(report) {
    if (!report) return;
    if (!this.state.highlights) this.state.highlights = {};
    if (!Array.isArray(this.state.highlights.importReports)) {
      this.state.highlights.importReports = [];
    }
    this.state.highlights.importReports.unshift(report);
    this.state.highlights.importReports = this.state.highlights.importReports.slice(0, 6);
    this.renderHighlightImportReport();
  }

  renderHighlightImportReport() {
    const container = this.elements.highlightImportReport;
    const list = this.elements.highlightImportLog;
    if (!container || !list) return;
    const reports = Array.isArray(this.state.highlights?.importReports)
      ? this.state.highlights.importReports
      : [];
    if (!reports.length) {
      list.innerHTML = '<li class="empty">아직 리포트가 없습니다.</li>';
      return;
    }

    list.innerHTML = reports
      .map((report) => {
        const statusIcon =
          report.status === 'success' ? '✅' : report.status === 'warning' ? '⚠️' : '❌';
        const statusLabel =
          report.status === 'success' ? '성공' : report.status === 'warning' ? '경고 포함 성공' : '실패';
        const issues = [];
        if (Array.isArray(report.errors) && report.errors.length) {
          issues.push(`에러 ${report.errors.length}건`);
        }
        if (Array.isArray(report.warnings) && report.warnings.length) {
          issues.push(`경고 ${report.warnings.length}건`);
        }
        const metaParts = [];
        if (report.fileName) metaParts.push(report.fileName);
        if (report.stats?.frameCount) metaParts.push(`프레임 ${report.stats.frameCount}`);
        if (report.stats?.samplePlayers) metaParts.push(`플레이어 ${report.stats.samplePlayers}명`);
        const timeLabel = report.importedAt ? this.formatTime(report.importedAt) : '';
        return `
        <li class="${report.status}">
          <div class="highlight-import-report__status">${statusIcon} ${statusLabel}</div>
          <div class="highlight-import-report__message">${report.message || '임포트 처리 결과를 확인하세요.'}</div>
          <div class="highlight-import-report__meta">
            ${issues.length ? `<span>${issues.join(' · ')}</span>` : ''}
            ${metaParts.length ? `<span>${metaParts.join(' · ')}</span>` : ''}
            ${timeLabel ? `<span>${timeLabel}</span>` : ''}
          </div>
        </li>`;
      })
      .join('');
  }

  renderFavoriteHighlights() {
    const list = this.elements.favoriteHighlightList;
    if (!list) return;
    const favorites = Array.isArray(this.state.highlights?.favorites) ? this.state.highlights.favorites : [];
    if (!favorites.length) {
      list.innerHTML = '<li class="empty">즐겨찾은 클립이 없습니다.</li>';
      return;
    }
    const filtered = this.filterFavoriteClips(favorites);
    if (!filtered.length) {
      list.innerHTML = '<li class="empty">필터 조건에 맞는 즐겨찾기 클립이 없습니다.</li>';
      return;
    }
    list.innerHTML = filtered
      .map(
        (clip) => `
        <li>
          <div class="highlight-card" data-highlight-id="${clip.id}">
            <button type="button" class="highlight-card__body" data-action="play" data-highlight-id="${clip.id}">
              <span class="title">${clip.title || '하이라이트'}</span>
              <span class="subtitle">${clip.subtitle || ''}</span>
              ${this.renderClipTags(clip)}
            </button>
            <div class="highlight-card__actions">
              <button
                type="button"
                class="highlight-card__action highlight-card__action--favorite is-active"
                data-action="favorite"
                data-highlight-id="${clip.id}"
                aria-pressed="true"
                title="즐겨찾기 해제"
              >★</button>
              <button
                type="button"
                class="highlight-card__action"
                data-action="share"
                data-highlight-id="${clip.id}"
                title="클립 정보 공유"
              >🔗</button>
              <button
                type="button"
                class="highlight-card__action"
                data-action="export"
                data-highlight-id="${clip.id}"
                title="클립 JSON 다운로드"
              >⬇️</button>
            </div>
          </div>
        </li>`
      )
      .join('');

    list.querySelectorAll('[data-action="play"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.playFavoriteHighlight(id);
      });
    });

    list.querySelectorAll('[data-action="favorite"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.toggleHighlightFavorite(id);
      });
    });

    list.querySelectorAll('[data-action="share"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.shareHighlightClip(id);
      });
    });

    list.querySelectorAll('[data-action="export"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.highlightId;
        this.exportHighlightClip(id);
      });
    });

    list.querySelectorAll('.highlight-tag').forEach((tagButton) => {
      tagButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.toggleHighlightTag(tagButton.dataset.tag);
      });
    });
  }

  toggleHighlightFavorite(id) {
    if (!id) return;
    if (!this.highlightLibrary) {
      this.notify('현재 브라우저에서는 즐겨찾기를 사용할 수 없습니다.', 'warn');
      return;
    }
    if (this.highlightLibrary.has(id)) {
      this.highlightLibrary.remove(id);
      this.notify('즐겨찾기에서 제거했습니다.');
    } else {
      const clip = this.getClipById(id);
      if (!clip || !Array.isArray(clip.frames) || !clip.frames.length) {
        this.notify('하이라이트 데이터를 찾을 수 없습니다.', 'warn');
        return;
      }
      if (!Array.isArray(clip.tags) || !clip.tags.length) {
        clip.tags = this.buildClipTags(clip);
      }
      this.highlightLibrary.add(clip);
      this.notify('즐겨찾기에 추가했습니다.', 'success');
    }
    this.syncHighlightFavorites();
    this.renderHighlights();
  }

  async shareHighlightClip(id) {
    const clip = this.getClipById(id);
    if (!clip) {
      this.notify('하이라이트 정보를 찾을 수 없습니다.', 'warn');
      return;
    }
    const date = clip.timestamp ? new Date(clip.timestamp) : new Date();
    const lines = [
      '🐛 온라인 지렁이 배틀 하이라이트 공유!',
      `• 제목: ${clip.title || '하이라이트'}`,
      clip.subtitle ? `• 설명: ${clip.subtitle}` : null,
      typeof clip.round === 'number' ? `• 라운드: ${clip.round}` : null,
      `• 기록: ${date.toLocaleString()}`
    ].filter(Boolean);
    const shareText = lines.join('\n');
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        this.notify('하이라이트 정보를 클립보드에 복사했습니다.', 'success');
        return;
      }
    } catch (error) {
      // fall through to fallback
    }
    const fallback = window.prompt('다음 내용을 복사하세요.', shareText);
    if (fallback !== null) {
      this.notify('하이라이트 정보를 복사했습니다.');
    }
  }

  exportHighlightClip(id) {
    const clip = this.getClipById(id);
    if (!clip || !Array.isArray(clip.frames) || !clip.frames.length) {
      this.notify('내보낼 하이라이트 데이터를 찾을 수 없습니다.', 'warn');
      return;
    }
    const payload = {
      version: '1.0.0',
      exportedAt: Date.now(),
      clip: {
        id: clip.id,
        title: clip.title || '하이라이트',
        subtitle: clip.subtitle || '',
        round: clip.round || null,
        timestamp: clip.timestamp || Date.now(),
        meta: clip.meta || null,
        type: clip.type || null,
        tags: Array.isArray(clip.tags) && clip.tags.length ? clip.tags : this.buildClipTags(clip),
        frames: clip.frames
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `worm-highlight-${clip.id?.slice(0, 8) || 'clip'}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    this.notify('하이라이트 클립을 JSON으로 내보냈습니다.');
  }

  playFavoriteHighlight(id) {
    if (!id) return;
    const clip = this.highlightLibrary?.get(id);
    if (!clip) {
      this.notify('즐겨찾기 데이터를 찾을 수 없습니다.', 'warn');
      this.syncHighlightFavorites();
      this.renderHighlights();
      return;
    }
    this.playHighlightClip(clip);
  }

  handleClearFavoriteRequest() {
    if (!this.highlightLibrary || !this.highlightLibrary.list().length) {
      return;
    }
    const confirmed = window.confirm('즐겨찾은 하이라이트를 모두 삭제할까요?');
    if (!confirmed) return;
    this.highlightLibrary.clear();
    this.syncHighlightFavorites();
    this.renderHighlights();
    this.notify('즐겨찾은 하이라이트를 비웠습니다.');
  }

  renderAchievements() {
    const list = this.elements.achievementList;
    if (!list) return;
    const achievements = Array.isArray(this.state.achievements) ? this.state.achievements : [];
    if (!achievements.length) {
      list.innerHTML = '<li class="empty">게임 종료 후 업적을 확인하세요.</li>';
      return;
    }
    list.innerHTML = achievements
      .map((entry) => {
        const name = escapeHtml(entry.name ?? '플레이어');
        const color = entry.color || '#ffffff';
        const earnedList = Array.isArray(entry.achievements) ? entry.achievements : [];
        const badges = earnedList
          .map((achievement) => {
            const icon = escapeHtml(achievement.icon || '🏅');
            const title = escapeHtml(achievement.title || '업적');
            const description = escapeHtml(achievement.description || '');
            return `<li title="${description}"><span class="badge-icon">${icon}</span><span>${title}</span></li>`;
          })
          .join('');
        return `
        <li style="border-left-color:${color}">
          <div class="achievement-list__player">
            <span class="achievement-list__dot" style="background:${color}"></span>
            <strong>${name}</strong>
            <span class="achievement-count">${earnedList.length}개 업적</span>
          </div>
          <ul class="achievement-badges">${badges}</ul>
        </li>`;
      })
      .join('');
  }

  playHighlightClip(target) {
    const clip =
      typeof target === 'number'
        ? (this.state.highlights?.clips || [])[target]
        : target;
    if (!clip || !Array.isArray(clip.frames) || !clip.frames.length) {
      this.notify('하이라이트 데이터를 불러올 수 없습니다.', 'warn');
      return;
    }
    this.state.replay.frames = clip.frames;
    this.state.replay.index = 0;
    this.state.replay.playing = true;
    this.state.replay.speed = 1;
    this.state.replay.lastUpdate = performance.now();
    if (this.elements.replaySpeed) {
      this.elements.replaySpeed.value = this.state.replay.speed;
    }
    if (this.elements.replayProgress) {
      this.elements.replayProgress.max = Math.max(1, clip.frames.length - 1);
      this.elements.replayProgress.value = 0;
    }
    this.elements.replayModal.classList.remove('hidden');
    this.notify(`${clip.title || '하이라이트'} 재생을 시작합니다.`);
  }

  handleChatSubmit(event) {
    event.preventDefault();
    const message = this.elements.chatInput.value.trim();
    if (!message || !this.state.roomId || !this.state.playerId) return;
    this.socket.emit('chat:message', {
      roomId: this.state.roomId,
      playerId: this.state.playerId,
      message
    });
    this.elements.chatInput.value = '';
  }

  openReplayModal(frames) {
    if (!frames?.length) {
      this.notify('리플레이 데이터가 없습니다.', 'warn');
      return;
    }
    this.state.replay.frames = frames;
    this.state.replay.index = 0;
    this.state.replay.playing = false;
    this.elements.replayProgress.max = Math.max(1, frames.length - 1);
    this.elements.replayProgress.value = 0;
    this.elements.replayModal.classList.remove('hidden');
    this.notify('리플레이 준비 완료');
  }

  closeReplayModal() {
    this.state.replay.playing = false;
    this.elements.replayModal.classList.add('hidden');
  }

  playReplay() {
    if (!this.state.replay.frames.length) return;
    this.state.replay.playing = true;
    this.state.replay.lastUpdate = performance.now();
  }

  pauseReplay() {
    this.state.replay.playing = false;
  }

  attachEventListeners() {
    this.elements.colorButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!button.dataset.color) return;
        this.applyPreferredColor(button.dataset.color, { attemptChange: true });
      });
    });

    if (this.elements.modeSelect) {
      this.elements.modeSelect.addEventListener('change', (event) => {
        const selected = event.target.value;
        if (MODE_MAP.has(selected)) {
          this.state.preferences.mode = selected;
        } else {
          this.state.preferences.mode = GAME_MODES[0].key;
        }
        this.updateModeDescription();
      });
    }

    if (this.elements.chatForm) {
      this.elements.chatForm.addEventListener('submit', (event) => this.handleChatSubmit(event));
    }

    if (this.elements.quickJoin) {
      this.elements.quickJoin.addEventListener('click', async () => {
        const playerName = this.getPlayerName();
        await this.requestJoin('room:quick-join', {
          playerName,
          preferredColor: this.state.preferences.color,
          mode: this.state.preferences.mode
        });
      });
    }

    if (this.elements.createRoom) {
      this.elements.createRoom.addEventListener('click', async () => {
        const playerName = this.getPlayerName();
        await this.requestJoin('room:create', {
          name: `${playerName}의 방`,
          isPrivate: this.elements.privateToggle.checked,
          playerName,
          preferredColor: this.state.preferences.color,
          mode: this.state.preferences.mode
        });
      });
    }

    if (this.elements.joinRoom) {
      this.elements.joinRoom.addEventListener('click', async () => {
        const roomId = this.elements.roomId.value.trim();
        if (!roomId) {
          this.notify('방 코드를 입력해주세요', 'warn');
          return;
        }
        const playerName = this.getPlayerName();
        await this.requestJoin('room:join', {
          roomId,
          playerName,
          preferredColor: this.state.preferences.color
        });
      });
    }

    if (this.elements.refreshRooms) {
      this.elements.refreshRooms.addEventListener('click', () => {
        this.socket.emit('rooms:refresh');
      });
    }

    if (this.elements.clearHighlightFavorites) {
      this.elements.clearHighlightFavorites.addEventListener('click', () =>
        this.handleClearFavoriteRequest()
      );
    }

    if (this.elements.highlightSearch) {
      this.elements.highlightSearch.addEventListener('input', (event) => {
        this.updateHighlightSearch(event.target.value);
      });
    }

    if (Array.isArray(this.elements.highlightTagButtons)) {
      this.elements.highlightTagButtons.forEach((button) => {
        button.addEventListener('click', () => {
          this.toggleHighlightTag(button.dataset.tag);
        });
      });
    }

    if (this.elements.highlightImportButton && this.elements.highlightImportInput) {
      this.elements.highlightImportButton.addEventListener('click', () => {
        this.elements.highlightImportInput.click();
      });
      this.elements.highlightImportInput.addEventListener('change', async (event) => {
        const [file] = event.target.files || [];
        if (file) {
          await this.handleHighlightImport(file);
        }
        event.target.value = '';
      });
    }

    if (this.elements.replayButton) {
      this.elements.replayButton.addEventListener('click', () => {
        if (!this.state.roomId) {
          this.notify('먼저 게임에 참여하세요.', 'warn');
          return;
        }
        this.socket.emit('room:request-replay', { roomId: this.state.roomId });
      });
    }

    if (this.elements.closeReplay) {
      this.elements.closeReplay.addEventListener('click', () => this.closeReplayModal());
    }

    if (this.elements.replayPlay) {
      this.elements.replayPlay.addEventListener('click', () => this.playReplay());
    }

    if (this.elements.replayPause) {
      this.elements.replayPause.addEventListener('click', () => this.pauseReplay());
    }

    if (this.elements.replaySpeed) {
      this.elements.replaySpeed.addEventListener('input', (event) => {
        this.state.replay.speed = parseFloat(event.target.value);
      });
    }

    if (this.elements.replayProgress) {
      this.elements.replayProgress.addEventListener('input', (event) => {
        this.state.replay.index = parseInt(event.target.value, 10) || 0;
        this.state.replay.playing = false;
      });
    }

    if (this.elements.toggleAudio) {
      this.elements.toggleAudio.addEventListener('click', async () => {
        if (!this.state.audioEnabled) {
          await this.audio.enable();
          this.elements.toggleAudio.textContent = '🔇 사운드 끄기';
          this.notify('사운드가 활성화되었습니다.');
        } else {
          this.audio.disable();
          this.elements.toggleAudio.textContent = '🔊 사운드 켜기';
          this.notify('사운드가 비활성화되었습니다.');
        }
      });
    }

    if (this.elements.nameInput) {
      this.elements.nameInput.addEventListener('blur', () => {
        this.elements.nameInput.value = this.getPlayerName();
      });
    }
  }
}
