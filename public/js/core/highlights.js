const STORAGE_KEY = 'online-worm-battle.highlightFavorites.v1';
const MAX_FAVORITES = 10;

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

export class HighlightLibrary {
  constructor({ storage } = {}) {
    this.storage = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    this.favorites = new Map();
    this.load();
  }

  load() {
    if (!this.storage) return;
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = safeParse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return;
    parsed.items.forEach((item) => {
      if (!item || !item.id) return;
      this.favorites.set(item.id, item);
    });
  }

  save() {
    if (!this.storage) return;
    const payload = {
      version: 1,
      updatedAt: Date.now(),
      items: this.list()
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage quota errors
    }
  }

  list() {
    return [...this.favorites.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  has(id) {
    return this.favorites.has(id);
  }

  get(id) {
    return this.favorites.get(id) || null;
  }

  add(clip) {
    if (!clip?.id) return;
    const entry = {
      id: clip.id,
      title: clip.title || '하이라이트',
      subtitle: clip.subtitle || '',
      timestamp: clip.timestamp || Date.now(),
      round: clip.round || null,
      savedAt: Date.now(),
      frames: Array.isArray(clip.frames) ? clip.frames : [],
      meta: clip.meta || null
    };
    this.favorites.set(entry.id, entry);
    this.enforceLimit();
    this.save();
  }

  remove(id) {
    if (!this.favorites.delete(id)) return;
    this.save();
  }

  clear() {
    if (!this.favorites.size) return;
    this.favorites.clear();
    this.save();
  }

  enforceLimit() {
    if (this.favorites.size <= MAX_FAVORITES) return;
    const sorted = this.list();
    while (sorted.length > MAX_FAVORITES) {
      const victim = sorted.pop();
      if (victim?.id) this.favorites.delete(victim.id);
    }
  }
}
