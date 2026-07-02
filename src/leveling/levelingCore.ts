import {
  GuildMember,
  TextChannel,
  EmbedBuilder,
  Client,
} from "discord.js";
import { UserLevel, IUserLevel } from "../models/UserLevel";
import { getLevelConfig, ILevelConfig } from "../models/LevelConfig";
import { LevelReward } from "../models/LevelReward";
import { XpEvent } from "../models/XpEvent";

// ══════════════════════════════════════════════
// LEVEL MATH (MEE6-style curve)
// ══════════════════════════════════════════════

/** XP required to advance FROM `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Total XP required to REACH a given level from 0. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNext(l);
  return total;
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  totalXp: number;
}

/** Resolve a total-XP value into level + progress within the level. */
export function resolveLevel(totalXp: number): LevelProgress {
  let level = 0;
  let remaining = totalXp;
  let need = xpToNext(level);
  while (remaining >= need) {
    remaining -= need;
    level++;
    need = xpToNext(level);
  }
  return {
    level,
    xpIntoLevel: remaining,
    xpForNext: need,
    totalXp,
  };
}

// ══════════════════════════════════════════════
// ACTIVE MULTIPLIER (from scheduled XP events)
// ══════════════════════════════════════════════

export async function getActiveMultiplier(
  guildId: string,
): Promise<{ multiplier: number; labels: string[] }> {
  const now = new Date();
  const events = await XpEvent.find({
    guildId,
    active: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  });
  if (events.length === 0) return { multiplier: 1, labels: [] };
  // Multiply concurrent events together (e.g. 2x daily + 1.5x custom = 3x).
  const multiplier = events.reduce((m, e) => m * e.multiplier, 1);
  return { multiplier, labels: events.map((e) => e.label || e.type) };
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export async function getUserLevel(
  guildId: string,
  userId: string,
): Promise<IUserLevel> {
  const doc = await UserLevel.findOneAndUpdate(
    { guildId, userId },
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc;
}

/** True if the member is blocked from earning XP (ignored role/channel/frozen). */
export function isExcluded(
  cfg: ILevelConfig,
  member: GuildMember,
  channelId?: string,
): boolean {
  if (cfg.locked) return true;
  if (channelId && cfg.ignoredChannels.includes(channelId)) return true;
  if (member.roles.cache.some((r) => cfg.ignoredRoles.includes(r.id)))
    return true;
  return false;
}

// ══════════════════════════════════════════════
// LEVEL-UP SIDE EFFECTS (rewards + announcement)
// ══════════════════════════════════════════════

async function applyRewards(member: GuildMember, newLevel: number) {
  const cfg = await getLevelConfig(member.guild.id);
  const rewards = await LevelReward.find({
    guildId: member.guild.id,
    level: { $lte: newLevel },
  }).sort({ level: 1 });

  if (rewards.length === 0) return;

  if (cfg.stackRewards) {
    // Grant every reward at or below the current level.
    for (const r of rewards) {
      if (!member.roles.cache.has(r.roleId)) {
        await member.roles.add(r.roleId).catch(() => null);
      }
    }
  } else {
    // Only the highest reward attained.
    const target = rewards[rewards.length - 1];
    const toRemove = rewards.filter((r) => r.level !== target.level);
    for (const r of toRemove) {
      if (member.roles.cache.has(r.roleId)) {
        await member.roles.remove(r.roleId).catch(() => null);
      }
    }
    if (!member.roles.cache.has(target.roleId)) {
      await member.roles.add(target.roleId).catch(() => null);
    }
  }
}

async function announceLevelUp(
  client: Client,
  member: GuildMember,
  newLevel: number,
) {
  const cfg = await getLevelConfig(member.guild.id);
  if (!cfg.levelUpEnabled) return;

  const message = cfg.levelUpMessage
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user.username)
    .replace(/\{level\}/g, String(newLevel))
    .replace(/\{guild\}/g, member.guild.name);

  const embed = new EmbedBuilder()
    .setTitle("📈 Level Up!")
    .setDescription(message)
    .setColor(0x5865f2)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  // DM
  if (cfg.levelUpDM) {
    await member
      .send({ embeds: [embed] })
      .catch(() => null);
  }

  // Channel
  if (cfg.levelUpChannelId === "-") return; // explicitly silenced
  let targetChannel: TextChannel | null = null;
  if (cfg.levelUpChannelId) {
    const ch = member.guild.channels.cache.get(cfg.levelUpChannelId);
    if (ch && ch.isTextBased()) targetChannel = ch as TextChannel;
  }
  await (targetChannel ?? null)?.send({ embeds: [embed] }).catch(() => null);
}

// ══════════════════════════════════════════════
// CORE XP AWARD
// ══════════════════════════════════════════════

interface AwardResult {
  leveledUp: boolean;
  newLevel: number;
  xpGained: number;
}

/**
 * Internal: grant XP to a user, handle level-ups + side effects.
 * Assumes exclusions / cooldown have already been checked by the caller
 * (or intentionally bypassed for admin grants).
 */
async function grantXp(
  client: Client,
  member: GuildMember,
  rawAmount: number,
  opts: { applyMultiplier?: boolean; silent?: boolean } = {},
): Promise<AwardResult> {
  const { applyMultiplier = true, silent = false } = opts;
  let amount = rawAmount;
  if (applyMultiplier) {
    const { multiplier } = await getActiveMultiplier(member.guild.id);
    amount = Math.round(amount * multiplier);
  }
  if (amount <= 0) return { leveledUp: false, newLevel: 0, xpGained: 0 };

  const user = await getUserLevel(member.guild.id, member.id);
  const oldLevel = resolveLevel(user.xp).level;
  user.xp += amount;
  user.dailyXp += amount;
  user.weeklyXp += amount;
  user.monthlyXp += amount;
  const prog = resolveLevel(user.xp);
  user.level = prog.level;
  const leveledUp = prog.level > oldLevel;

  await user.save();

  if (leveledUp) {
    for (let l = oldLevel + 1; l <= prog.level; l++) {
      await applyRewards(member, l);
      if (!silent) await announceLevelUp(client, member, l);
    }
  }

  return { leveledUp, newLevel: prog.level, xpGained: amount };
}

// ══════════════════════════════════════════════
// MESSAGE XP (with cooldown + daily streak)
// ══════════════════════════════════════════════

export async function awardMessageXp(
  client: Client,
  member: GuildMember,
  channelId: string,
): Promise<AwardResult | null> {
  const cfg = await getLevelConfig(member.guild.id);
  if (!cfg.messageXpEnabled) return null;
  if (isExcluded(cfg, member, channelId)) return null;
  if (member.user.bot) return null;

  const user = await getUserLevel(member.guild.id, member.id);

  // Cooldown
  if (user.lastXpAt) {
    const elapsed = (Date.now() - user.lastXpAt.getTime()) / 1000;
    if (elapsed < cfg.cooldownSeconds) return null;
  }
  user.lastXpAt = new Date();

  // Daily streak
  let streakBonus = 0;
  if (cfg.streakEnabled) {
    const today = todayStr();
    if (user.lastActiveDay !== today) {
      const yesterday = todayStr(new Date(Date.now() - 86400000));
      if (user.lastActiveDay === yesterday) {
        user.dailyStreak += 1;
      } else {
        user.dailyStreak = 1;
      }
      user.lastActiveDay = today;
      if (user.dailyStreak > user.bestDailyStreak)
        user.bestDailyStreak = user.dailyStreak;
      streakBonus = Math.round(cfg.streakBonusXp * user.dailyStreak);
    }
  }

  // Base message XP (random within range)
  const min = Math.min(cfg.minXpPerMessage, cfg.maxXpPerMessage);
  const max = Math.max(cfg.minXpPerMessage, cfg.maxXpPerMessage);
  const baseXp =
    min === max ? min : Math.floor(Math.random() * (max - min + 1)) + min;

  user.totalMessages += 1;
  await user.save();

  return grantXp(client, member, baseXp + streakBonus, { applyMultiplier: true });
}

// ══════════════════════════════════════════════
// VOICE XP (granted periodically while connected)
// ══════════════════════════════════════════════

export async function awardVoiceXp(
  client: Client,
  member: GuildMember,
  minutes: number,
): Promise<AwardResult | null> {
  const cfg = await getLevelConfig(member.guild.id);
  if (!cfg.voiceXpEnabled) return null;
  if (isExcluded(cfg, member)) return null;
  if (member.user.bot) return null;

  const user = await getUserLevel(member.guild.id, member.id);
  user.totalVoiceMinutes += minutes;
  await user.save();

  const xp = Math.round(cfg.voiceXpPerMinute * minutes);
  return grantXp(client, member, xp, { applyMultiplier: true });
}

// ══════════════════════════════════════════════
// ADMIN OPERATIONS
// ══════════════════════════════════════════════

export async function addXp(
  client: Client,
  member: GuildMember,
  amount: number,
): Promise<AwardResult> {
  return grantXp(client, member, amount, { applyMultiplier: false });
}

export async function removeXp(
  client: Client,
  member: GuildMember,
  amount: number,
): Promise<{ newLevel: number; xpRemoved: number }> {
  const user = await getUserLevel(member.guild.id, member.id);
  const oldLevel = resolveLevel(user.xp).level;
  user.xp = Math.max(0, user.xp - amount);
  const prog = resolveLevel(user.xp);
  user.level = prog.level;
  await user.save();
  // Demote rewards that are now above the user's level.
  const rewards = await LevelReward.find({
    guildId: member.guild.id,
    level: { $gt: prog.level },
  });
  for (const r of rewards) {
    if (member.roles.cache.has(r.roleId)) {
      await member.roles.remove(r.roleId).catch(() => null);
    }
  }
  return { newLevel: prog.level, xpRemoved: amount };
}

export async function setLevel(
  client: Client,
  member: GuildMember,
  level: number,
): Promise<{ oldLevel: number; newLevel: number }> {
  const user = await getUserLevel(member.guild.id, member.id);
  const oldLevel = resolveLevel(user.xp).level;
  const target = Math.max(0, Math.floor(level));
  user.xp = totalXpForLevel(target);
  user.level = target;
  await user.save();

  // Apply rewards for the new level (no announcements on manual set).
  if (target > oldLevel) {
    for (let l = oldLevel + 1; l <= target; l++) {
      await applyRewards(member, l);
    }
  } else if (target < oldLevel) {
    const rewards = await LevelReward.find({
      guildId: member.guild.id,
      level: { $gt: target },
    });
    for (const r of rewards) {
      if (member.roles.cache.has(r.roleId)) {
        await member.roles.remove(r.roleId).catch(() => null);
      }
    }
  }
  return { oldLevel, newLevel: target };
}

export async function resetUser(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const res = await UserLevel.deleteOne({ guildId, userId });
  return res.deletedCount > 0;
}

export async function resetGuild(guildId: string): Promise<number> {
  const res = await UserLevel.deleteMany({ guildId });
  return res.deletedCount || 0;
}

// ══════════════════════════════════════════════
// PERIOD RESETS (daily / weekly / monthly buckets)
// ══════════════════════════════════════════════

function isSameDay(a: Date, b: Date): boolean {
  return todayStr(a) === todayStr(b);
}

function isSameWeek(a: Date, b: Date): boolean {
  // Week starts Monday.
  const start = (d: Date) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // Mon=0..Sun=6
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - day);
    return x;
  };
  return start(a).getTime() === start(b).getTime();
}

function isSameMonth(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
  );
}

/** Roll the period buckets forward if their boundary has passed. Pass `"*"` to reset for all guilds. */
export async function rollPeriods(guildId: string): Promise<void> {
  const now = new Date();
  const filter = guildId === "*" ? {} : { guildId };
  const users = await UserLevel.find(filter);
  for (const u of users) {
    const updates: Partial<IUserLevel> = {};
    if (!isSameDay(u.dailyXpResetAt, now)) {
      updates.dailyXp = 0;
      updates.dailyXpResetAt = now;
    }
    if (!isSameWeek(u.weeklyXpResetAt, now)) {
      updates.weeklyXp = 0;
      updates.weeklyXpResetAt = now;
    }
    if (!isSameMonth(u.monthlyXpResetAt, now)) {
      updates.monthlyXp = 0;
      updates.monthlyXpResetAt = now;
    }
    if (Object.keys(updates).length > 0) {
      await UserLevel.updateOne({ _id: u._id }, { $set: updates });
    }
  }
  // Expire finished XP events.
  const evFilter = guildId === "*" ? { active: true, endsAt: { $lt: now } } : { guildId, active: true, endsAt: { $lt: now } };
  await XpEvent.updateMany(evFilter, { $set: { active: false } });
}