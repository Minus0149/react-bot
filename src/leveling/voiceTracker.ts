import { Client, VoiceState, GuildMember } from "discord.js";
import { awardVoiceXp } from "./levelingCore";
import { getLevelConfig } from "../models/LevelConfig";

/**
 * Tracks members currently sitting in a "qualifying" voice channel and
 * periodically grants them voice XP. A channel qualifies when it has at
 * least 2 non-bot members and isn't the guild's AFK channel; a member
 * qualifies when they aren't self-muted/self-deafened.
 *
 * Kept as an in-memory Map — fine for a single-process bot.
 */

// key = `${guildId}:${userId}`
const activeVoice = new Map<string, { guildId: string; userId: string }>();

function qualifies(member: GuildMember): boolean {
  if (member.user.bot) return false;
  const vs = member.voice;
  if (!vs.channelId) return false;
  if (vs.selfMute || vs.selfDeaf || vs.serverMute || vs.serverDeaf) return false;
  if (vs.channelId === vs.guild.afkChannelId) return false;
  const channel = vs.channel;
  if (!channel) return false;
  const nonBot = channel.members.filter((m) => !m.user.bot);
  return nonBot.size >= 2;
}

export function handleVoiceStateChange(oldState: VoiceState, newState: VoiceState) {
  const key = `${newState.guild.id}:${newState.id}`;
  const nowQualifies = qualifies(newState.member ?? oldState.member!);

  if (!nowQualifies) {
    activeVoice.delete(key);
    return;
  }

  // If they switched between two qualifying channels, we just keep them
  // active (no XP gap — they were talking the whole time).
  activeVoice.set(key, {
    guildId: newState.guild.id,
    userId: newState.id,
  });
}

/**
 * Periodic tick: grant each active member their per-interval slice of
 * voice XP. Started once from the `ready` event.
 */
export async function voiceTick(client: Client) {
  if (activeVoice.size === 0) return;

  // Snapshot then clear; re-qualified members will re-add themselves on the
  // next voiceStateUpdate if still talking — but to avoid dropping users who
  // stay connected across a tick (no state event fires), we instead iterate
  // and re-validate against live data, keeping them if still qualified.
  const entries = [...activeVoice.values()];
  for (const { guildId, userId } of entries) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      activeVoice.delete(`${guildId}:${userId}`);
      continue;
    }
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !qualifies(member)) {
      activeVoice.delete(`${guildId}:${userId}`);
      continue;
    }
    const cfg = await getLevelConfig(guildId);
    if (!cfg.voiceXpEnabled || cfg.locked) continue;
    const minutes = cfg.voiceXpIntervalSeconds / 60;
    await awardVoiceXp(client, member, minutes).catch(() => null);
  }
}

/** Start the periodic voice XP loop. */
export function startVoiceTracker(client: Client) {
  const intervalMs = 60_000; // base tick; actual XP scaled by config interval
  setInterval(() => {
    voiceTick(client).catch((e) => console.error("[VoiceXP] tick error:", e));
  }, intervalMs);
  console.log(`🎙️ Voice XP tracker running (tick every ${intervalMs / 1000}s)`);
}