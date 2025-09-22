const cloneClip = (clip) => {
  try {
    return typeof structuredClone === 'function' ? structuredClone(clip) : JSON.parse(JSON.stringify(clip));
  } catch (error) {
    return null;
  }
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normaliseTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const result = [];
  tags.forEach((tag) => {
    if (typeof tag !== 'string') return;
    const value = tag.trim().toLowerCase();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
};

const validateFrame = (frame, index, errors, warnings) => {
  if (!isObject(frame)) {
    errors.push(`${index + 1}번째 프레임이 객체가 아닙니다.`);
    return;
  }
  if (typeof frame.timestamp !== 'number') {
    warnings.push(`${index + 1}번째 프레임의 timestamp가 누락되어 기본값(0)으로 처리됩니다.`);
    frame.timestamp = typeof frame.timestamp === 'number' ? frame.timestamp : 0;
  }
  if (!Array.isArray(frame.players)) {
    warnings.push(`${index + 1}번째 프레임의 플레이어 목록이 유효하지 않습니다.`);
    frame.players = Array.isArray(frame.players) ? frame.players : [];
  }
  const sanitisedPlayers = [];
  frame.players.forEach((player, playerIndex) => {
    if (!isObject(player)) {
      warnings.push(
        `${index + 1}번째 프레임의 플레이어(${playerIndex + 1}) 데이터가 객체가 아니어서 제외됩니다.`
      );
      return;
    }
    sanitisedPlayers.push(player);
    if (!Array.isArray(player.segments) || !player.segments.length) {
      warnings.push(
        `${index + 1}번째 프레임의 플레이어(${player.name || player.id || playerIndex + 1})가 세그먼트 없이 기록됐습니다.`
      );
    }
  });
  frame.players = sanitisedPlayers;
};

export const validateHighlightClip = ({ clip, sourceName } = {}) => {
  const errors = [];
  const warnings = [];
  if (!clip) {
    errors.push('하이라이트 데이터가 비어 있습니다.');
    return { errors, warnings, clip: null, stats: null };
  }

  const normalised = cloneClip(clip);
  if (!normalised) {
    errors.push('하이라이트 데이터를 복사하는 중 문제가 발생했습니다.');
    return { errors, warnings, clip: null, stats: null };
  }

  if (!Array.isArray(normalised.frames) || !normalised.frames.length) {
    errors.push('프레임 데이터가 비어 있거나 배열이 아닙니다.');
  } else {
    const sampleLength = Math.min(normalised.frames.length, 6);
    for (let i = 0; i < sampleLength; i += 1) {
      validateFrame(normalised.frames[i], i, errors, warnings);
    }
    const frameCount = normalised.frames.length;
    const maxFrameCheck = frameCount > 300 ? 120 : frameCount;
    for (let i = sampleLength; i < maxFrameCheck; i += Math.max(1, Math.floor(frameCount / 60))) {
      validateFrame(normalised.frames[i], i, errors, warnings);
    }
  }

  if (!normalised.title || typeof normalised.title !== 'string') {
    warnings.push('제목이 없어 기본 제목(하이라이트)이 사용됩니다.');
    normalised.title = '하이라이트';
  }

  if (normalised.subtitle && typeof normalised.subtitle !== 'string') {
    warnings.push('부제목이 문자열이 아니라 제거됩니다.');
    delete normalised.subtitle;
  }

  if (typeof normalised.startFrame !== 'number') {
    warnings.push('startFrame이 없어 0으로 대체됩니다.');
    normalised.startFrame = 0;
  }
  if (typeof normalised.endFrame !== 'number') {
    warnings.push('endFrame이 없어 프레임 길이 기준으로 대체됩니다.');
    normalised.endFrame = Array.isArray(normalised.frames) ? normalised.frames.length - 1 : normalised.startFrame;
  }
  if (normalised.endFrame < normalised.startFrame) {
    errors.push('endFrame이 startFrame보다 작습니다.');
  }

  if (!isObject(normalised.meta)) {
    warnings.push('meta 정보를 객체로 해석할 수 없어 초기화합니다.');
    normalised.meta = {};
  }

  if (!Number.isFinite(normalised.timestamp)) {
    warnings.push('timestamp가 없어 현재 시각으로 대체됩니다.');
    normalised.timestamp = Date.now();
  }

  normalised.tags = normaliseTags(normalised.tags);

  const samplePlayers = new Set();
  if (Array.isArray(normalised.frames)) {
    normalised.frames.slice(0, 10).forEach((frame) => {
      if (!Array.isArray(frame.players)) return;
      frame.players.forEach((player) => {
        if (player?.id) samplePlayers.add(player.id);
      });
    });
  }

  const stats = {
    sourceName: sourceName || null,
    frameCount: Array.isArray(normalised.frames) ? normalised.frames.length : 0,
    samplePlayers: samplePlayers.size
  };

  return {
    clip: normalised,
    errors,
    warnings,
    stats
  };
};
