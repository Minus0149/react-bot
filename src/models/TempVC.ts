import { Schema, model, Document } from "mongoose";

export interface ITempVCSettings {
  locked: boolean;
  hidden: boolean;
  userLimit: number;
  bitrate: number;
  region: string | null;
}

export interface ITempVC extends Document {
  guildId: string;
  channelId: string;
  ownerId: string;
  createdAt: Date;
  settings: ITempVCSettings;
  banned: string[];
  permitted: string[];
}

const TempVCSchema = new Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  settings: {
    locked: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    userLimit: { type: Number, default: 0 },
    bitrate: { type: Number, default: 64 },
    region: { type: String, default: null },
  },
  banned: [{ type: String }],
  permitted: [{ type: String }],
});

TempVCSchema.index({ guildId: 1, channelId: 1 }, { unique: true });
TempVCSchema.index({ guildId: 1, ownerId: 1 });

export const TempVC = model<ITempVC>("TempVC", TempVCSchema);
