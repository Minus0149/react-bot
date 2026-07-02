import { Schema, model, Document } from "mongoose";

/**
 * Per-user leveling data for a guild.
 *
 * Tracks total (all-time) XP plus separate daily / weekly / monthly XP
 * buckets that reset on their respective period boundaries, so the
 * leaderboards can be sliced per period without losing all-time data.
 */
export interface IUserLevel extends Document {
  guildId: string;
  userId: string;

  // ── All-time progression ──
  xp: number;
  level: number;
  totalMessages: number;
  totalVoiceMinutes: number;

  // ── Period buckets (reset by the scheduler) ──
  dailyXp: number;
  weeklyXp: number;
  monthlyXp: number;
  dailyXpResetAt: Date;
  weeklyXpResetAt: Date;
  monthlyXpResetAt: Date;

  // ── Anti-spam cooldown ──
  lastXpAt: Date;

  // ── Daily activity streak ──
  lastActiveDay: string; // YYYY-MM-DD
  dailyStreak: number;
  bestDailyStreak: number;

  // ── Voice tracking helpers ──
  voiceJoinAt: Date | null;
}

const UserLevelSchema = new Schema<IUserLevel>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    totalVoiceMinutes: { type: Number, default: 0 },
    dailyXp: { type: Number, default: 0 },
    weeklyXp: { type: Number, default: 0 },
    monthlyXp: { type: Number, default: 0 },
    dailyXpResetAt: { type: Date, default: () => new Date() },
    weeklyXpResetAt: { type: Date, default: () => new Date() },
    monthlyXpResetAt: { type: Date, default: () => new Date() },
    lastXpAt: { type: Date, default: null },
    lastActiveDay: { type: String, default: "" },
    dailyStreak: { type: Number, default: 0 },
    bestDailyStreak: { type: Number, default: 0 },
    voiceJoinAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Compound index for fast per-guild leaderboard queries.
UserLevelSchema.index({ guildId: 1, xp: -1 });
UserLevelSchema.index({ guildId: 1, dailyXp: -1 });
UserLevelSchema.index({ guildId: 1, weeklyXp: -1 });
UserLevelSchema.index({ guildId: 1, monthlyXp: -1 });

export const UserLevel = model<IUserLevel>("UserLevel", UserLevelSchema);