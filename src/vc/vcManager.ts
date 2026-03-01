import {
  Client,
  VoiceState,
  ChannelType,
  PermissionsBitField,
  GuildMember,
  VoiceChannel,
  GuildChannel,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  TextChannel,
} from "discord.js";
import { GuildVC, IGuildVC } from "../models/GuildVC";
import { TempVC, ITempVC, ITempVCSettings } from "../models/TempVC";

// ──────────────────────────────────────────────
// 🎙️  VC MANAGER — Core lifecycle & cache
// ──────────────────────────────────────────────

export interface VCData {
  guildId: string;
  channelId: string;
  ownerId: string;
  settings: ITempVCSettings;
  banned: string[];
  permitted: string[];
}

// In-memory caches for O(1) lookups
const activeVCs = new Map<string, VCData>(); // channelId → VCData
const guildConfigs = new Map<string, IGuildVC>(); // guildId → config
const deleteTimers = new Map<string, ReturnType<typeof setTimeout>>(); // channelId → timer
// Rate limiter: channelId → Map<action, lastTimestamp>
const rateLimits = new Map<string, Map<string, number>>();

const DELETE_GRACE_PERIOD = 10_000; // 10s before deleting empty VC

// Discord rate limits (in ms):
// Channel name/topic: 2 per 10 minutes
// Permission overwrites: 10 per 15 seconds
const RATE_LIMITS: Record<string, { window: number; max: number }> = {
  rename: { window: 600_000, max: 2 }, // 2 per 10 min
  bitrate: { window: 15_000, max: 10 }, // 10 per 15s
  region: { window: 15_000, max: 10 }, // 10 per 15s
  permissions: { window: 15_000, max: 8 }, // leave headroom under 10/15s
};

/**
 * Check if an action is rate-limited for a channel.
 * Returns remaining cooldown seconds, or 0 if allowed.
 */
export function checkRateLimit(channelId: string, action: string): number {
  const limit = RATE_LIMITS[action];
  if (!limit) return 0;

  if (!rateLimits.has(channelId)) rateLimits.set(channelId, new Map());
  const channelLimits = rateLimits.get(channelId)!;

  const now = Date.now();
  const lastTime = channelLimits.get(action) || 0;
  const elapsed = now - lastTime;

  if (elapsed < limit.window / limit.max) {
    return Math.ceil((limit.window / limit.max - elapsed) / 1000);
  }

  return 0;
}

/**
 * Record that an action was performed.
 */
export function recordAction(channelId: string, action: string): void {
  if (!rateLimits.has(channelId)) rateLimits.set(channelId, new Map());
  rateLimits.get(channelId)!.set(action, Date.now());
}

/**
 * Cleanup rate limit data for a deleted channel.
 */
export function clearRateLimits(channelId: string): void {
  rateLimits.delete(channelId);
}

// Privileged roles that always retain access to locked/hidden VCs
function getPrivilegedRoleIds(): string[] {
  const botIds = (process.env.BOT_ROLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const modIds = (process.env.MOD_ROLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...botIds, ...modIds];
}

export function getModRoleIds(): string[] {
  return (process.env.MOD_ROLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getBotRoleIds(): string[] {
  return (process.env.BOT_ROLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ══════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════

export async function initVCSystem(client: Client): Promise<void> {
  console.log("🔄 Hydrating VC cache...");
  const start = Date.now();

  try {
    // Load guild configs
    const configs = await GuildVC.find({});
    for (const config of configs) {
      guildConfigs.set(config.guildId, config);
    }

    // Load active temp VCs & validate
    const tempVCs = await TempVC.find({});
    let cleaned = 0;

    for (const vc of tempVCs) {
      try {
        const guild = client.guilds.cache.get(vc.guildId);
        if (!guild) {
          await TempVC.deleteOne({ channelId: vc.channelId });
          cleaned++;
          continue;
        }

        const channel = guild.channels.cache.get(vc.channelId);
        if (!channel) {
          // Channel was deleted while bot was offline
          await TempVC.deleteOne({ channelId: vc.channelId });
          cleaned++;
          continue;
        }

        // Valid — add to cache
        activeVCs.set(vc.channelId, {
          guildId: vc.guildId,
          channelId: vc.channelId,
          ownerId: vc.ownerId,
          settings: vc.settings,
          banned: vc.banned,
          permitted: vc.permitted,
        });
      } catch {
        await TempVC.deleteOne({ channelId: vc.channelId }).catch(() => null);
        cleaned++;
      }
    }

    console.log(
      `✅ VC cache hot: ${activeVCs.size} active VCs, ${guildConfigs.size} guild configs ` +
        `(${cleaned} orphans cleaned) in ${Date.now() - start}ms`,
    );
  } catch (error) {
    console.error(
      "⚠️ VC cache hydration failed (DB may be unavailable). System will work on-demand:",
      error,
    );
  }
}

// ══════════════════════════════════════════════
// GUILD CONFIG
// ══════════════════════════════════════════════

export function getGuildConfig(guildId: string): IGuildVC | undefined {
  return guildConfigs.get(guildId);
}

export async function setGuildConfig(config: IGuildVC): Promise<void> {
  guildConfigs.set(config.guildId, config);
}

export async function deleteGuildConfig(guildId: string): Promise<void> {
  guildConfigs.delete(guildId);
  await GuildVC.deleteOne({ guildId });
}

// ══════════════════════════════════════════════
// VC LOOKUPS
// ══════════════════════════════════════════════

export function getVCByChannel(channelId: string): VCData | undefined {
  return activeVCs.get(channelId);
}

export function getVCByOwner(
  guildId: string,
  userId: string,
): VCData | undefined {
  for (const vc of activeVCs.values()) {
    if (vc.guildId === guildId && vc.ownerId === userId) return vc;
  }
  return undefined;
}

export function getUserVC(
  guildId: string,
  userId: string,
  member?: GuildMember,
): VCData | undefined {
  // First check if user owns a VC
  const owned = getVCByOwner(guildId, userId);
  if (owned) return owned;

  // Then check if user is in a temp VC
  if (member?.voice?.channelId) {
    const vc = getVCByChannel(member.voice.channelId);
    if (vc) return vc;
  }

  return undefined;
}

export function isVCOwner(channelId: string, userId: string): boolean {
  const vc = activeVCs.get(channelId);
  return vc ? vc.ownerId === userId : false;
}

export function isActiveVC(channelId: string): boolean {
  return activeVCs.has(channelId);
}

// ══════════════════════════════════════════════
// VC CREATION & DELETION
// ══════════════════════════════════════════════

export async function createTempVC(
  member: GuildMember,
  config: IGuildVC,
): Promise<VoiceChannel | null> {
  const guild = member.guild;

  // Prevent multiple VCs per user
  const existing = getVCByOwner(guild.id, member.id);
  if (existing) {
    // Move user to their existing VC instead
    const existingChannel = guild.channels.cache.get(existing.channelId) as
      | VoiceChannel
      | undefined;
    if (existingChannel) {
      await member.voice.setChannel(existingChannel).catch(() => null);
      return existingChannel;
    } else {
      // Channel gone, cleanup
      await deleteTempVCData(existing.channelId);
    }
  }

  try {
    // Build permission overwrites — owner gets full control
    const botMember = guild.members.me!;
    const overwrites: any[] = [
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.MoveMembers,
          PermissionsBitField.Flags.MuteMembers,
          PermissionsBitField.Flags.DeafenMembers,
        ],
      },
      // Bot always keeps full access
      {
        id: botMember.id,
        allow: [
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageRoles,
          PermissionsBitField.Flags.MoveMembers,
          PermissionsBitField.Flags.MuteMembers,
          PermissionsBitField.Flags.DeafenMembers,
        ],
      },
    ];

    // Privileged roles (bots + mods) always have connect + view
    for (const roleId of getPrivilegedRoleIds()) {
      overwrites.push({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.ViewChannel,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: `${member.displayName}'s channel`,
      type: ChannelType.GuildVoice,
      parent: config.categoryId,
      permissionOverwrites: overwrites,
    });

    const vcData: VCData = {
      guildId: guild.id,
      channelId: channel.id,
      ownerId: member.id,
      settings: {
        locked: false,
        hidden: false,
        userLimit: 0,
        bitrate: 64,
        region: null,
      },
      banned: [],
      permitted: [],
    };

    // Write to cache
    activeVCs.set(channel.id, vcData);

    // Write to DB
    await TempVC.create({
      guildId: guild.id,
      channelId: channel.id,
      ownerId: member.id,
      settings: vcData.settings,
      banned: [],
      permitted: [],
    });

    // Move user to their new VC
    await member.voice.setChannel(channel).catch(() => null);

    return channel;
  } catch (error) {
    console.error("[VC] Failed to create temp VC:", error);
    return null;
  }
}

export async function deleteTempVC(channelId: string): Promise<void> {
  const vc = activeVCs.get(channelId);
  if (!vc) return;

  // Clear any pending delete timer
  clearDeleteTimer(channelId);

  try {
    // Try to delete the Discord channel
    const guild = (await import("discord.js")).default; // no-op, we get it from cache
  } catch {
    // Channel may already be deleted — that's fine
  }

  await deleteTempVCData(channelId);
}

async function deleteTempVCData(channelId: string): Promise<void> {
  activeVCs.delete(channelId);
  await TempVC.deleteOne({ channelId }).catch(() => null);
}

function scheduleDelete(channelId: string, client: Client): void {
  clearDeleteTimer(channelId);

  const timer = setTimeout(async () => {
    const vc = activeVCs.get(channelId);
    if (!vc) return;

    try {
      const guild = client.guilds.cache.get(vc.guildId);
      const channel = guild?.channels.cache.get(channelId) as
        | VoiceChannel
        | undefined;

      if (channel && channel.members.size === 0) {
        await channel.delete("Temp VC empty — auto-cleanup").catch(() => null);
        await deleteTempVCData(channelId);
        console.log(`🗑️ Auto-deleted empty VC: ${channelId}`);
      }
    } catch {
      await deleteTempVCData(channelId);
    }

    deleteTimers.delete(channelId);
  }, DELETE_GRACE_PERIOD);

  deleteTimers.set(channelId, timer);
}

function clearDeleteTimer(channelId: string): void {
  const timer = deleteTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    deleteTimers.delete(channelId);
  }
}

// ══════════════════════════════════════════════
// OWNERSHIP
// ══════════════════════════════════════════════

export async function transferOwnership(
  channelId: string,
  newOwnerId: string,
  client?: Client,
): Promise<boolean> {
  const vc = activeVCs.get(channelId);
  if (!vc) return false;

  vc.ownerId = newOwnerId;
  await TempVC.updateOne(
    { channelId },
    { $set: { ownerId: newOwnerId } },
  ).catch(() => null);

  // Rename channel to new owner's name
  if (client) {
    try {
      const guild = client.guilds.cache.get(vc.guildId);
      const channel = guild?.channels.cache.get(channelId) as
        | VoiceChannel
        | undefined;
      const newOwner = await guild?.members.fetch(newOwnerId).catch(() => null);
      if (channel && newOwner) {
        await channel
          .setName(`${newOwner.displayName}'s channel`)
          .catch(() => null);
      }
    } catch {
      /* rate-limited or unavailable — non-critical */
    }
  }

  return true;
}

export async function claimVC(
  channelId: string,
  claimerId: string,
  client: Client,
): Promise<boolean> {
  const vc = activeVCs.get(channelId);
  if (!vc) return false;

  // Check the current owner is NOT in the channel
  const guild = client.guilds.cache.get(vc.guildId);
  const channel = guild?.channels.cache.get(channelId) as
    | VoiceChannel
    | undefined;
  if (!channel) return false;

  const ownerInChannel = channel.members.has(vc.ownerId);
  if (ownerInChannel) return false; // Owner is still there

  // Check claimer IS in the channel
  const claimerInChannel = channel.members.has(claimerId);
  if (!claimerInChannel) return false;

  return transferOwnership(channelId, claimerId, client);
}

// ══════════════════════════════════════════════
// VC SETTINGS MUTATIONS
// ══════════════════════════════════════════════

export async function updateVCSettings(
  channelId: string,
  updates: Partial<ITempVCSettings>,
): Promise<void> {
  const vc = activeVCs.get(channelId);
  if (!vc) return;

  Object.assign(vc.settings, updates);

  const dbUpdates: Record<string, any> = {};
  for (const [key, value] of Object.entries(updates)) {
    dbUpdates[`settings.${key}`] = value;
  }

  await TempVC.updateOne({ channelId }, { $set: dbUpdates }).catch(() => null);
}

export async function addBanned(
  channelId: string,
  userId: string,
): Promise<void> {
  const vc = activeVCs.get(channelId);
  if (!vc) return;
  if (!vc.banned.includes(userId)) {
    vc.banned.push(userId);
    await TempVC.updateOne(
      { channelId },
      { $addToSet: { banned: userId } },
    ).catch(() => null);
  }
}

export async function removeBanned(
  channelId: string,
  userId: string,
): Promise<void> {
  const vc = activeVCs.get(channelId);
  if (!vc) return;
  vc.banned = vc.banned.filter((id) => id !== userId);
  await TempVC.updateOne({ channelId }, { $pull: { banned: userId } }).catch(
    () => null,
  );
}

export async function addPermitted(
  channelId: string,
  userId: string,
): Promise<void> {
  const vc = activeVCs.get(channelId);
  if (!vc) return;
  if (!vc.permitted.includes(userId)) {
    vc.permitted.push(userId);
    await TempVC.updateOne(
      { channelId },
      { $addToSet: { permitted: userId } },
    ).catch(() => null);
  }
}

export async function removePermitted(
  channelId: string,
  userId: string,
): Promise<void> {
  const vc = activeVCs.get(channelId);
  if (!vc) return;
  vc.permitted = vc.permitted.filter((id) => id !== userId);
  await TempVC.updateOne({ channelId }, { $pull: { permitted: userId } }).catch(
    () => null,
  );
}

// ══════════════════════════════════════════════
// EVENT HANDLERS
// ══════════════════════════════════════════════

export async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
  client: Client,
): Promise<void> {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guildId = newState.guild.id || oldState.guild.id;
  const config = guildConfigs.get(guildId);

  if (!config) return;

  // ── User joined "Join to Create" ──
  if (
    newState.channelId === config.joinToCreateId &&
    oldState.channelId !== config.joinToCreateId
  ) {
    console.log(`[VC] Creating temp VC for ${member.displayName}...`);
    await createTempVC(member, config);
    return;
  }

  // ── User left a temp VC ──
  if (oldState.channelId && activeVCs.has(oldState.channelId)) {
    const oldChannel = oldState.guild.channels.cache.get(oldState.channelId) as
      | VoiceChannel
      | undefined;

    if (oldChannel && oldChannel.members.size === 0) {
      // Schedule deletion with grace period
      scheduleDelete(oldState.channelId, client);
    } else if (oldChannel && oldChannel.members.size > 0) {
      // Cancel any pending delete
      clearDeleteTimer(oldState.channelId);
    }
  }

  // ── User joined a temp VC (cancel pending delete) ──
  if (newState.channelId && activeVCs.has(newState.channelId)) {
    clearDeleteTimer(newState.channelId);
  }

  // ── User joined "Waiting Room" ──
  if (
    newState.channelId === config.waitingRoomId &&
    oldState.channelId !== config.waitingRoomId
  ) {
    // Find waiting room channel
    const waitingRoom = newState.guild.channels.cache.get(
      config.waitingRoomId,
    ) as VoiceChannel | undefined;
    if (!waitingRoom) return;

    // Get list of active locked/hidden VCs
    const availableVCs: {
      label: string;
      value: string;
      description: string;
    }[] = [];

    for (const [id, vcData] of activeVCs.entries()) {
      // Only show VCs from this guild
      if (vcData.guildId !== guildId) continue;

      const vcChannel = newState.guild.channels.cache.get(id) as
        | VoiceChannel
        | undefined;
      if (!vcChannel) continue;

      const owner = newState.guild.members.cache.get(vcData.ownerId);
      const ownerName = owner?.displayName || "Unknown";

      const status = vcData.settings.locked ? "🔒 Locked" : "🔓 Open";

      availableVCs.push({
        label: vcChannel.name,
        value: vcData.channelId,
        description: `Owner: ${ownerName} • ${status} • ${vcChannel.members.size} member(s)`,
      });
    }

    if (availableVCs.length === 0) {
      await waitingRoom
        .send({
          content: `👋 Hi <@${member.id}>! You're in the Waiting Room, but there are no active Custom Voice Channels to join right now.`,
        })
        .then((msg) => setTimeout(() => msg.delete().catch(() => null), 15000));
      return;
    }

    // Sort alphabetically
    availableVCs.sort((a, b) => a.label.localeCompare(b.label));
    // Limit to 25 options (Discord limit)
    const options = availableVCs.slice(0, 25);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("vc_request_join")
        .setPlaceholder("Select a channel to request access...")
        .addOptions(options),
    );

    await waitingRoom
      .send({
        content: `👋 Hi <@${member.id}>! You've joined the Waiting Room.\nSelect a Voice Channel below to request access from its owner:`,
        components: [row],
      })
      .then((msg) => setTimeout(() => msg.delete().catch(() => null), 60000)); // Clean up after 60s
  }
}

export async function handleChannelDelete(
  channel: GuildChannel,
): Promise<void> {
  if (activeVCs.has(channel.id)) {
    clearDeleteTimer(channel.id);
    await deleteTempVCData(channel.id);
    console.log(`🗑️ Cleaned up deleted temp VC: ${channel.id}`);
  }
}
