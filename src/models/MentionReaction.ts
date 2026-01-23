import { Schema, model, Document } from "mongoose";

export interface IMentionReaction extends Document {
  guildId: string;
  triggerUserId: string;
  emojis: string[];
}

const MentionReactionSchema = new Schema({
  guildId: { type: String, required: true },
  triggerUserId: { type: String, required: true },
  emojis: [{ type: String, required: true }],
});

MentionReactionSchema.index({ guildId: 1, triggerUserId: 1 }, { unique: true });

export const MentionReaction = model<IMentionReaction>(
  "MentionReaction",
  MentionReactionSchema,
);
