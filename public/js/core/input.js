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

export class InputManager {
  constructor({ state, socket, elements }) {
    this.state = state;
    this.socket = socket;
    this.elements = elements;
    this.lastDirection = null;
    this.pointerId = null;
    this.stickCenter = { x: 0, y: 0 };
    this.pointerMedia = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
  }

  init() {
    document.addEventListener('keydown', (event) => {
      if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
      const direction = directionKeys.get(event.code);
      if (!direction) return;
      this.sendDirection(direction);
    });

    this.setupMobileStick();
    this.updateMobileVisibility();
    window.addEventListener('resize', () => this.updateMobileVisibility());
    if (this.pointerMedia) {
      const handler = () => this.updateMobileVisibility();
      if (typeof this.pointerMedia.addEventListener === 'function') {
        this.pointerMedia.addEventListener('change', handler);
      } else if (typeof this.pointerMedia.addListener === 'function') {
        this.pointerMedia.addListener(handler);
      }
    }
  }

  updateMobileVisibility() {
    if (!this.elements.mobileControls) return;
    const coarsePointer = this.pointerMedia?.matches ?? false;
    const shouldShow = window.innerWidth <= 1200 || coarsePointer;
    this.elements.mobileControls.classList.toggle('is-visible', shouldShow);
  }

  sendDirection(direction) {
    if (!this.state.playerId) return;
    if (this.lastDirection && this.lastDirection.x === direction.x && this.lastDirection.y === direction.y) {
      return;
    }
    this.lastDirection = direction;
    this.socket.emit('player:input', {
      playerId: this.state.playerId,
      direction
    });
  }

  setupMobileStick() {
    const stick = this.elements.mobileStick;
    const handle = this.elements.mobileStickHandle;
    if (!stick || !handle) return;

    const maxDistance = 48;

    const updateHandle = (dx, dy) => {
      const distance = Math.min(Math.hypot(dx, dy), maxDistance);
      if (!Number.isFinite(distance)) return;
      const angle = Math.atan2(dy, dx);
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      handle.style.transform = `translate(${x}px, ${y}px)`;

      if (distance < 12) return;
      if (Math.abs(x) > Math.abs(y)) {
        this.sendDirection({ x: x > 0 ? 1 : -1, y: 0 });
      } else {
        this.sendDirection({ x: 0, y: y > 0 ? 1 : -1 });
      }
    };

    const resetHandle = () => {
      handle.style.transform = 'translate(0, 0)';
      this.pointerId = null;
    };

    const onPointerDown = (event) => {
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      const rect = stick.getBoundingClientRect();
      this.stickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      stick.setPointerCapture(this.pointerId);
      updateHandle(event.clientX - this.stickCenter.x, event.clientY - this.stickCenter.y);
    };

    const onPointerMove = (event) => {
      if (event.pointerId !== this.pointerId) return;
      updateHandle(event.clientX - this.stickCenter.x, event.clientY - this.stickCenter.y);
    };

    const onPointerUp = (event) => {
      if (event.pointerId !== this.pointerId) return;
      stick.releasePointerCapture(this.pointerId);
      resetHandle();
    };

    stick.addEventListener('pointerdown', onPointerDown);
    stick.addEventListener('pointermove', onPointerMove);
    stick.addEventListener('pointerup', onPointerUp);
    stick.addEventListener('pointercancel', onPointerUp);
    stick.addEventListener('pointerleave', (event) => {
      if (event.pointerId === this.pointerId) {
        resetHandle();
      }
    });
  }
}
