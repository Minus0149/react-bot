import { Schema, model, Document } from "mongoose";

export interface IGuildVC extends Document {
  guildId: string;
  categoryId: string;
  joinToCreateId: string;
  waitingRoomId: string;
  settingsChannelId: string;
  interfaceMessageId: string;
}

const GuildVCSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  categoryId: { type: String, required: true },
  joinToCreateId: { type: String, required: true },
  waitingRoomId: { type: String, required: true },
  settingsChannelId: { type: String, required: true },
  interfaceMessageId: { type: String, default: "" },
});

export const GuildVC = model<IGuildVC>("GuildVC", GuildVCSchema);
