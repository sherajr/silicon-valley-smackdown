// Central tuning table. Keep balance numbers here rather than scattered
// through the codebase so playtesting adjustments stay in one place.

export const SIM_FPS = 60;
export const SIM_DT = 1 / SIM_FPS;

export const BASE_WIDTH = 480;
export const BASE_HEIGHT = 270;

export const GROUND_Y = 230;
export const STAGE_LEFT_WALL = 40;
export const STAGE_RIGHT_WALL = BASE_WIDTH - 40;

export const ROUND_TIME_SECONDS = 90;
export const ROUND_TIME_FRAMES = ROUND_TIME_SECONDS * SIM_FPS;
export const ROUNDS_TO_WIN = 2;

export const GRAVITY = 0.62; // px/frame^2
export const JUMP_APEX_GRACE = 2;

export const PUSHBOX_SEPARATION_PADDING = 2;

// Input buffering / chords
export const ATTACK_BUFFER_FRAMES = 6;
export const CHORD_WINDOW_FRAMES = 2;
export const GRAB_ESCAPE_WINDOW_FRAMES = 8;
export const DASH_DOUBLE_TAP_WINDOW_FRAMES = 14;

// Hit-stop (freeze frames applied to both fighters on impact)
export const HITSTOP_LIGHT = 3;
export const HITSTOP_HEAVY = 6;
export const HITSTOP_SUPER = 9;

// Guard gauge
export const MAX_GUARD = 100;
export const GUARD_BREAK_STUN_FRAMES = 55;
export const GUARD_REGEN_DELAY_FRAMES = 90; // no chip/block for this long before regen starts
export const GUARD_REGEN_PER_FRAME = 0.6;
export const GUARD_BREAK_REFILL = 30; // gauge restored after a break so it can't instantly re-break

// Hype meter
export const MAX_HYPE = 100;
export const HYPE_GAIN_ON_DEAL_RATIO = 1.1; // hype gained per point of damage dealt
export const HYPE_GAIN_ON_TAKE_RATIO = 0.45; // hype gained per point of damage taken

// Combo rules
export const COMBO_HIT_CAP = 5;
export const COMBO_DAMAGE_CAP_RATIO = 0.35; // fraction of defender max health
export const COMBO_SCALING = [1, 1, 0.85, 0.7, 0.55, 0.4]; // index = hit number (0-based) within combo
export const COMBO_RESET_FRAMES = 45; // neutral frames before combo counter resets

// Knockdown / wake-up
export const KNOCKDOWN_FRAMES = 40;
export const WAKEUP_INVULN_FRAMES = 20;

// Pickups
export const PICKUP_FIRST_SPAWN_SECONDS = 10;
export const PICKUP_MIN_INTERVAL_SECONDS = 12;
export const PICKUP_MAX_INTERVAL_SECONDS = 16;
export const PICKUP_LIFETIME_SECONDS = 9;
export const PICKUP_TELEGRAPH_FRAMES = 45;
export const GPU_DAMAGE_MULT = 1.25;
export const GPU_DURATION_FRAMES = 8 * SIM_FPS;
export const COFFEE_SPEED_MULT = 1.2;
export const COFFEE_DURATION_FRAMES = 8 * SIM_FPS;
export const SIGNING_BONUS_HEAL = 20;

// AI reaction delay targets (ms), converted to frames by caller
export const AI_REACTION_MS: Record<'easy' | 'normal' | 'hard', [number, number]> = {
  easy: [300, 450],
  normal: [180, 280],
  hard: [110, 180],
};

export const CRUNCH_MODE_HEALTH_THRESHOLD = 0.45;
