import { Schema, model, Document } from "mongoose";

/**
 * Per-guild leveling configuration. Every knob an admin can manage from the
 * `/level config` command lives here, with sensible defaults so the system
 * works out of the box.
 */
export interface ILevelConfig extends Document {
  guildId: string;

  // ── Message XP ──
  messageXpEnabled: boolean;
  minXpPerMessage: number;
  maxXpPerMessage: number;
  cooldownSeconds: number;

  // ── Voice XP ──
  voiceXpEnabled: boolean;
  voiceXpPerMinute: number;
  voiceXpIntervalSeconds: number; // how often voice XP is granted

  // ── Daily streak bonus ──
  streakEnabled: boolean;
  streakBonusXp: number;

  // ── Level-up announcements ──
  levelUpEnabled: boolean;
  levelUpChannelId: string; // "" = current channel
  levelUpDM: boolean;
  levelUpMessage: string; // {user} {level} {guild}

  // ── Role rewards ──
  stackRewards: boolean;

  // ── Ignored channels / roles (no XP earned) ──
  ignoredChannels: string[];
  ignoredRoles: string[];

  // ── Global freeze ──
  locked: boolean;
}

const LevelConfigSchema = new Schema<ILevelConfig>(
  {
    guildId: { type: String, required: true, unique: true },
    messageXpEnabled: { type: Boolean, default: true },
    minXpPerMessage: { type: Number, default: 15 },
    maxXpPerMessage: { type: Number, default: 25 },
    cooldownSeconds: { type: Number, default: 60 },
    voiceXpEnabled: { type: Boolean, default: true },
    voiceXpPerMinute: { type: Number, default: 5 },
    voiceXpIntervalSeconds: { type: Number, default: 60 },
    streakEnabled: { type: Boolean, default: true },
    streakBonusXp: { type: Number, default: 10 },
    levelUpEnabled: { type: Boolean, default: true },
    levelUpChannelId: { type: String, default: "" },
    levelUpDM: { type: Boolean, default: false },
    levelUpMessage: {
      type: String,
      default: "🎉 {user} reached **level {level}** in **{guild}**!",
    },
    stackRewards: { type: Boolean, default: false },
    ignoredChannels: { type: [String], default: [] },
    ignoredRoles: { type: [String], default: [] },
    locked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const LevelConfig = model<ILevelConfig>("LevelConfig", LevelConfigSchema);

export async function getLevelConfig(guildId: string): Promise<ILevelConfig> {
  const cfg = await LevelConfig.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { upsert: true, new: true, lean: false },
  );
  return cfg;
}