import { Schema, model, Document } from "mongoose";

/**
 * A role automatically granted/removed when a user crosses a given level.
 * One document per (guild, level).
 */
export interface ILevelReward extends Document {
  guildId: string;
  level: number;
  roleId: string;
  removePrevious: boolean; // when stacking is off, remove other reward roles
}

const LevelRewardSchema = new Schema<ILevelReward>(
  {
    guildId: { type: String, required: true, index: true },
    level: { type: Number, required: true },
    roleId: { type: String, required: true },
    removePrevious: { type: Boolean, default: true },
  },
  { timestamps: true },
);

LevelRewardSchema.index({ guildId: 1, level: 1 }, { unique: true });

export const LevelReward = model<ILevelReward>("LevelReward", LevelRewardSchema);