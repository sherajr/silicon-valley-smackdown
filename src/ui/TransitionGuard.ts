import type { InputManager } from '../input/InputManager';

/**
 * Prevents a held button from "carrying over" across a scene transition and
 * accidentally confirming/skipping the next screen. Arm on scene create();
 * poll() every frame; only accept confirm/cancel input once ready() is true.
 */
export class TransitionGuard {
  private heldAtArm = new Set<string>();
  private armedAt = 0;
  private isReady = false;

  arm(input: InputManager): void {
    this.heldAtArm = new Set(input.getHeldCodes());
    this.armedAt = performance.now();
    this.isReady = this.heldAtArm.size === 0;
  }

  poll(input: InputManager): void {
    if (this.isReady) return;
    const stillHeld = [...this.heldAtArm].some((c) => input.isCodeHeld(c));
    if (!stillHeld || performance.now() - this.armedAt > 2000) {
      this.isReady = true;
    }
  }

  ready(): boolean {
    return this.isReady;
  }
}
