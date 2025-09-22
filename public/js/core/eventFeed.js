import { EVENT_FEED_TYPES, createEventFeedToggleDefaults } from './state.js';

const STORAGE_KEY = 'owb.event-feed';
const PULSE_DURATION_MS = 520;
const HIGHLIGHT_DURATION_MS = 1600;
const HIGHLIGHT_CLEAR_DELAY_MS = 2000;

const defaultNotify = () => {};
const defaultGetLabel = () => '이벤트';

export class EventFeedView {
  constructor({ state, elements, notify, getLabel, onFiltersChange } = {}) {
    this.state = state;
    this.elements = elements;
    this.notify = typeof notify === 'function' ? notify : defaultNotify;
    this.getLabel = typeof getLabel === 'function' ? getLabel : defaultGetLabel;
    this.onFiltersChange = typeof onFiltersChange === 'function' ? onFiltersChange : null;

    this.highlights = new Map();
    this.pulseTimeout = null;
    this.highlightClearTimeout = null;
    this.storageWarning = { load: false, save: false };
    this.boundFilters = false;
  }

  init() {
    this.ensurePreferences();
    this.restorePreferences();
    this.syncFilterControls();
    this.bindFilterControls();
  }

  ensurePreferences() {
    if (!this.state.preferences || typeof this.state.preferences !== 'object') {
      this.state.preferences = {};
    }
    if (!this.state.preferences.eventFeed || typeof this.state.preferences.eventFeed !== 'object') {
      this.state.preferences.eventFeed = {
        filters: createEventFeedToggleDefaults()
      };
    }
    const eventFeed = this.state.preferences.eventFeed;
    if (!eventFeed.filters || typeof eventFeed.filters !== 'object') {
      eventFeed.filters = createEventFeedToggleDefaults();
    } else {
      EVENT_FEED_TYPES.forEach(({ key }) => {
        if (typeof eventFeed.filters[key] !== 'boolean') {
          eventFeed.filters[key] = true;
        }
      });
    }
    return eventFeed;
  }

  getFilters() {
    const preferences = this.ensurePreferences();
    return preferences.filters;
  }

  bindFilterControls() {
    if (this.boundFilters) return;
    const inputs = this.elements?.eventFilterCheckboxes || [];
    inputs.forEach((input) => {
      if (!input) return;
      input.addEventListener('change', (event) => {
        const checkbox = event.currentTarget;
        const type = checkbox?.dataset?.eventFilter;
        if (!type) return;
        this.setFilter(type, checkbox.checked);
      });
    });
    this.boundFilters = true;
  }

  setFilter(type, enabled, { silent = false } = {}) {
    if (!type) return;
    const preferences = this.ensurePreferences();
    const next = Boolean(enabled);
    if (preferences.filters[type] === next) return;
    preferences.filters[type] = next;
    this.persistPreferences();
    this.syncFilterControls();
    if (!silent) {
      const label = this.getLabel(type);
      this.notify(
        next ? `${label} 이벤트를 피드에 표시합니다.` : `${label} 이벤트를 피드에서 숨깁니다.`,
        'info'
      );
    }
    if (this.onFiltersChange) {
      this.onFiltersChange({ type, enabled: next });
    }
  }

  persistPreferences() {
    const preferences = this.ensurePreferences();
    const serializedFilters = {};
    EVENT_FEED_TYPES.forEach(({ key }) => {
      serializedFilters[key] = preferences.filters?.[key] !== false;
    });
    preferences.filters = { ...serializedFilters };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ filters: serializedFilters }));
    } catch (error) {
      if (!this.storageWarning.save) {
        console.warn('이벤트 피드 설정 저장 실패:', error);
        this.storageWarning.save = true;
      }
    }
  }

  restorePreferences() {
    const preferences = this.ensurePreferences();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed.filters === 'object') {
          EVENT_FEED_TYPES.forEach(({ key }) => {
            if (typeof parsed.filters[key] === 'boolean') {
              preferences.filters[key] = Boolean(parsed.filters[key]);
            }
          });
        }
      }
    } catch (error) {
      if (!this.storageWarning.load) {
        console.warn('이벤트 피드 설정 불러오기 실패:', error);
        this.storageWarning.load = true;
      }
    }
  }

  syncFilterControls() {
    const filters = this.getFilters();
    const inputs = this.elements?.eventFilterCheckboxes || [];
    inputs.forEach((input) => {
      if (!input?.dataset?.eventFilter) return;
      const key = input.dataset.eventFilter;
      input.checked = filters?.[key] !== false;
    });
  }

  handleEvents(events = []) {
    if (!Array.isArray(events) || !events.length) return;
    const visible = events.filter((event) => this.isTypeEnabled(event));
    if (!visible.length) return;
    this.cleanupExpiredHighlights();
    const now = Date.now();
    const expireAt = now + HIGHLIGHT_DURATION_MS;
    visible.forEach((event, index) => {
      if (!event) return;
      const rawId =
        event.id != null
          ? String(event.id)
          : `${now}-${index}-${Math.random().toString(16).slice(2)}`;
      this.highlights.set(rawId, expireAt);
    });
    this.applyPulse();
    this.scheduleHighlightClear();
  }

  applyPulse() {
    const container = this.elements?.eventFeed;
    if (!container) return;
    container.classList.add('event-feed--pulse');
    if (this.pulseTimeout) {
      window.clearTimeout(this.pulseTimeout);
    }
    this.pulseTimeout = window.setTimeout(() => {
      container.classList.remove('event-feed--pulse');
      this.pulseTimeout = null;
    }, PULSE_DURATION_MS);
  }

  scheduleHighlightClear() {
    if (this.highlightClearTimeout) {
      window.clearTimeout(this.highlightClearTimeout);
    }
    this.highlightClearTimeout = window.setTimeout(() => {
      this.highlights.clear();
      this.highlightClearTimeout = null;
    }, HIGHLIGHT_CLEAR_DELAY_MS);
  }

  cleanupExpiredHighlights() {
    if (!this.highlights?.size) return;
    const now = Date.now();
    for (const [id, expiry] of this.highlights.entries()) {
      if (!Number.isFinite(expiry) || expiry <= now) {
        this.highlights.delete(id);
      }
    }
  }

  shouldHighlight(event) {
    if (!event) return false;
    if (!this.highlights?.size) return false;
    const id = event.id != null ? String(event.id) : null;
    if (!id) return false;
    const expiry = this.highlights.get(id);
    if (!Number.isFinite(expiry)) {
      this.highlights.delete(id);
      return false;
    }
    if (expiry <= Date.now()) {
      this.highlights.delete(id);
      return false;
    }
    return true;
  }

  isTypeEnabled(event) {
    const type = typeof event === 'string' ? event : event?.type;
    if (!type) return true;
    const filters = this.getFilters();
    if (Object.prototype.hasOwnProperty.call(filters, type)) {
      return Boolean(filters[type]);
    }
    return true;
  }
}
