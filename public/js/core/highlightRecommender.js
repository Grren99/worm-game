const TYPE_BASE_SCORE = new Map([
  ['kill', 80],
  ['golden-food', 68],
  ['powerup', 55],
  ['round-end', 42]
]);

const TAG_BONUS = new Map([
  ['first-kill', { label: '퍼스트 킬', value: 24 }],
  ['golden', { label: '골든 음식', value: 18 }],
  ['powerup:speed', { label: '속도 파워업', value: 14 }],
  ['powerup:shield', { label: '무적 파워업', value: 14 }],
  ['powerup:shrink', { label: '축소 파워업', value: 12 }],
  ['victory', { label: '우승 장면', value: 20 }],
  ['my-play', { label: '내 플레이', value: 20 }],
  ['my-win', { label: '내 승리', value: 22 }],
  ['my-death', { label: '내 탈락', value: 8 }],
  ['draw', { label: '무승부 장면', value: 8 }]
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normaliseTags = (clip) => {
  if (!clip) return [];
  const raw = Array.isArray(clip.tags) ? clip.tags : [];
  const tags = [];
  raw.forEach((tag) => {
    if (typeof tag !== 'string') return;
    const lowered = tag.trim().toLowerCase();
    if (!lowered || tags.includes(lowered)) return;
    tags.push(lowered);
  });
  return tags;
};

const normaliseComponents = (clip, options = {}) => {
  const components = [];
  const tags = normaliseTags(clip);
  const meta = clip?.meta || {};

  const baseValue = TYPE_BASE_SCORE.get(clip?.type) ?? 36;
  components.push({ label: '핵심 장면', value: baseValue });

  if (meta.killerName && meta.victimName) {
    components.push({ label: `${meta.killerName} ▶ ${meta.victimName}`, value: 22 });
  } else if (meta.playerName) {
    components.push({ label: `${meta.playerName}의 플레이`, value: 16 });
  }

  if (tags.includes('collision')) {
    components.push({ label: '충돌 승리', value: 12 });
  }

  if (tags.includes('wall') || meta.cause === 'wall') {
    components.push({ label: '벽 몰이', value: 10 });
  }

  tags.forEach((tag) => {
    const bonus = TAG_BONUS.get(tag);
    if (bonus) components.push(bonus);
  });

  if (options.playerId) {
    if (meta.killerId === options.playerId || meta.playerId === options.playerId) {
      components.push({ label: '내 활약상', value: 28 });
    }
    if (meta.victimId === options.playerId) {
      components.push({ label: '내 탈락 장면', value: 12 });
    }
    if (meta.winnerId === options.playerId) {
      components.push({ label: '내 우승 장면', value: 20 });
    }
  }

  const preferredTags = Array.isArray(options.preferredTags) ? options.preferredTags : [];
  preferredTags.forEach((tag) => {
    if (tags.includes(tag)) {
      components.push({ label: `관심 태그: ${tag}`, value: 10 });
    }
  });

  const statsContext = options.stats || [];
  if (Array.isArray(statsContext) && statsContext.length && meta.playerId) {
    const stat = statsContext.find((entry) => entry.playerId === meta.playerId);
    if (stat?.kills >= 3) {
      components.push({ label: '다수 킬 라운드', value: 14 });
    }
    if (stat?.golden >= 2) {
      components.push({ label: '골든 연속 기록', value: 12 });
    }
  }

  return { components, tags };
};

const computeScore = ({ components, clip, favorites, now }) => {
  const raw = components.reduce((sum, item) => sum + (item.value || 0), 0);
  const timestamp = typeof clip?.timestamp === 'number' ? clip.timestamp : now;
  const ageMinutes = clamp((now - timestamp) / 60000, 0, 60);
  const freshness = clamp(1 - ageMinutes * 0.08, 0.55, 1);
  const favoritePenalty = favorites?.has(clip?.id) ? 18 : 0;
  const bounded = Math.max(0, raw * freshness - favoritePenalty);
  return Math.round(bounded);
};

const buildReason = (components) => {
  if (!components.length) return '최근 경기 기반 추천 클립입니다.';
  const sorted = [...components].sort((a, b) => (b.value || 0) - (a.value || 0));
  const top = sorted.slice(0, 2).map((entry) => entry.label);
  return top.length ? top.join(' · ') : '최근 경기 기반 추천 클립입니다.';
};

export const recommendClips = (entries = [], options = {}) => {
  if (!Array.isArray(entries) || !entries.length) return [];
  const favorites = options.favorites instanceof Set ? options.favorites : new Set();
  const now = Date.now();
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 3;

  const scored = entries
    .map((entry) => {
      const { clip, index } = entry || {};
      if (!clip) return null;
      const { components, tags } = normaliseComponents(clip, {
        playerId: options.playerId,
        preferredTags: options.preferredTags,
        stats: options.stats
      });
      const score = computeScore({ components, clip, favorites, now });
      if (score <= 0) return null;
      return {
        clip,
        index,
        score,
        reason: buildReason(components),
        tags,
        components
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
};
