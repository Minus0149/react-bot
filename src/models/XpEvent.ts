import { Schema, model, Document } from "mongoose";

/**
 * A time-bound global XP multiplier event (e.g. "2x XP weekend").
 * Admins create these with `/level multiplier add`; they auto-expire at
 * `endsAt` and are picked up when awarding XP.
 */
export interface IXpEvent extends Document {
  guildId: string;
  label: string;
  multiplier: number; // e.g. 2 = 2x XP
  type: "daily" | "weekly" | "monthly" | "custom";
  active: boolean;
  startsAt: Date;
  endsAt: Date;
}

const XpEventSchema = new Schema<IXpEvent>(
  {
    guildId: { type: String, required: true, index: true },
    label: { type: String, default: "" },
    multiplier: { type: Number, default: 1, min: 0 },
    type: {
      type: String,
      enum: ["daily", "weekly", "monthly", "custom"],
      default: "custom",
    },
    active: { type: Boolean, default: true },
    startsAt: { type: Date, default: () => new Date() },
    endsAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const XpEvent = model<IXpEvent>("XpEvent", XpEventSchema);