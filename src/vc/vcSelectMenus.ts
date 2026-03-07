import {
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
  GuildMember,
  VoiceChannel,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
} from "discord.js";
import {
  getVCByOwner,
  getVCByChannel,
  updateVCSettings,
  addBanned,
  removeBanned,
  addPermitted,
  transferOwnership,
  VCData,
  checkRateLimit,
  recordAction,
  getGuildConfig,
} from "./vcManager";

// ──────────────────────────────────────────────
// 📋  VC SELECT MENUS — Interaction handlers
// ──────────────────────────────────────────────

const VC_SELECT_IDS = [
  "vc_select_invite",
  "vc_select_ban",
  "vc_select_permit",
  "vc_select_permit_role",
  "vc_select_transfer",
  "vc_select_region",
  "vc_approve_waiting",
  "vc_request_join",
];

export function isVCSelectMenu(customId: string): boolean {
  return VC_SELECT_IDS.includes(customId);
}

export async function handleVCSelectMenu(
  interaction:
    | StringSelectMenuInteraction
    | UserSelectMenuInteraction
    | RoleSelectMenuInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember;
  if (!member) {
    await interaction.reply({
      content: "❌ Could not resolve your membership.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Some are StringSelectMenus
  if (interaction.customId === "vc_select_region") {
    return handleRegionSelect(
      interaction as StringSelectMenuInteraction,
      member,
    );
  }

  if (interaction.customId === "vc_request_join") {
    return handleRequestJoin(
      interaction as StringSelectMenuInteraction,
      member,
    );
  }

  // All others are UserSelectMenus or RoleSelectMenus
  switch (interaction.customId) {
    case "vc_select_invite":
      return handleInviteSelect(
        interaction as UserSelectMenuInteraction,
        member,
      );
    case "vc_select_ban":
      return handleBanSelect(interaction as UserSelectMenuInteraction, member);
    case "vc_select_permit":
      return handlePermitSelect(
        interaction as UserSelectMenuInteraction,
        member,
      );
    case "vc_select_permit_role":
      return handlePermitRoleSelect(
        interaction as RoleSelectMenuInteraction,
        member,
      );
    case "vc_select_transfer":
      return handleTransferSelect(
        interaction as UserSelectMenuInteraction,
        member,
      );
    case "vc_approve_waiting":
      return handleApproveWaiting(
        interaction as UserSelectMenuInteraction,
        member,
      );
    default:
      await interaction.reply({
        content: "❌ Unknown selection.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

// ── Helpers ──

function getOwnerVC(
  guildId: string,
  memberId: string,
): { vc: VCData; channel: VoiceChannel } | null {
  const vc = getVCByOwner(guildId, memberId);
  if (!vc) return null;
  return { vc, channel: null as any }; // channel resolved by caller
}

async function resolveUserVC(
  interaction: UserSelectMenuInteraction | StringSelectMenuInteraction,
  member: GuildMember,
): Promise<{ vc: VCData; channel: VoiceChannel } | null> {
  const vc = getVCByOwner(interaction.guildId!, member.id);
  if (!vc || vc.ownerId !== member.id) {
    await interaction.update({
      content: "❌ You don't own a voice channel.",
      components: [],
    });
    return null;
  }

  const channel = interaction.guild!.channels.cache.get(vc.channelId) as
    | VoiceChannel
    | undefined;
  if (!channel) {
    await interaction.update({
      content: "❌ Your voice channel no longer exists.",
      components: [],
    });
    return null;
  }

  return { vc, channel };
}

// ── Invite ──

async function handleInviteSelect(
  interaction: UserSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const resolved = await resolveUserVC(interaction, member);
  if (!resolved) return;

  const targetId = interaction.values[0];
  const target = await interaction
    .guild!.members.fetch(targetId)
    .catch(() => null);
  if (!target) {
    await interaction.update({ content: "❌ User not found.", components: [] });
    return;
  }

  // Grant connect + view permissions
  await resolved.channel.permissionOverwrites.edit(targetId, {
    Connect: true,
    ViewChannel: true,
  });
  await addPermitted(resolved.vc.channelId, targetId);

  // Attempt to DM the user
  let dmStatus = "";
  try {
    const vcLink = `https://discord.com/channels/${resolved.channel.guildId}/${resolved.channel.id}`;
    await target.send(
      `✉️ **${member.displayName}** has invited you to join their private Voice Channel!\n\nClick here to join: ${vcLink}`,
    );
    dmStatus = " They have been DM'd a link to join.";
  } catch (err) {
    dmStatus = " (Could not DM them, their DMs might be closed).";
  }

  await interaction.update({
    content: `✉️ ${target.displayName} has been **invited** to your channel.${dmStatus}`,
    components: [],
  });
}

// ── Ban ──

async function handleBanSelect(
  interaction: UserSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const resolved = await resolveUserVC(interaction, member);
  if (!resolved) return;

  const targetId = interaction.values[0];

  if (targetId === member.id) {
    await interaction.update({
      content: "❌ You can't ban yourself.",
      components: [],
    });
    return;
  }

  const target = await interaction
    .guild!.members.fetch(targetId)
    .catch(() => null);

  // Deny connect permission
  await resolved.channel.permissionOverwrites.edit(targetId, {
    Connect: false,
  });
  await addBanned(resolved.vc.channelId, targetId);

  // Disconnect them if they're in the channel
  if (target?.voice?.channelId === resolved.vc.channelId) {
    await target.voice?.disconnect("Banned from VC by owner").catch(() => null);
  }

  await interaction.update({
    content: `🚫 ${target?.displayName || targetId} has been **banned** from your channel.`,
    components: [],
  });
}

// ── Permit ──

async function handlePermitSelect(
  interaction: UserSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const resolved = await resolveUserVC(interaction, member);
  if (!resolved) return;

  const targetId = interaction.values[0];

  // Remove ban overwrite and grant access
  await resolved.channel.permissionOverwrites
    .delete(targetId)
    .catch(() => null);
  await resolved.channel.permissionOverwrites.edit(targetId, {
    Connect: true,
    ViewChannel: true,
  });
  await removeBanned(resolved.vc.channelId, targetId);
  await addPermitted(resolved.vc.channelId, targetId);

  const target = await interaction
    .guild!.members.fetch(targetId)
    .catch(() => null);
  await interaction.update({
    content: `✅ ${target?.displayName || targetId} has been **permitted** — ban removed, access granted.`,
    components: [],
  });
}

// ── Permit Role ──

async function handlePermitRoleSelect(
  interaction: RoleSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const resolved = await resolveUserVC(interaction as any, member);
  if (!resolved) return;

  const roleId = interaction.values[0];
  const role = interaction.guild!.roles.cache.get(roleId);

  if (!role) {
    await interaction.update({ content: "❌ Role not found.", components: [] });
    return;
  }

  // Grant connect + view to the entire role
  await resolved.channel.permissionOverwrites.edit(roleId, {
    Connect: true,
    ViewChannel: true,
  });
  await addPermitted(resolved.vc.channelId, roleId);

  await interaction.update({
    content: `✅ Role **@${role.name}** has been **permitted** — all members with this role now have access.`,
    components: [],
  });
}

// ── Transfer ──

async function handleTransferSelect(
  interaction: UserSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const resolved = await resolveUserVC(interaction, member);
  if (!resolved) return;

  const targetId = interaction.values[0];

  if (targetId === member.id) {
    await interaction.update({
      content: "❌ You already own this channel.",
      components: [],
    });
    return;
  }

  const target = await interaction
    .guild!.members.fetch(targetId)
    .catch(() => null);
  if (!target) {
    await interaction.update({ content: "❌ User not found.", components: [] });
    return;
  }

  // Check target is in the VC
  if (target.voice?.channelId !== resolved.vc.channelId) {
    await interaction.update({
      content:
        "❌ That user must be in your voice channel to transfer ownership.",
      components: [],
    });
    return;
  }

  await transferOwnership(resolved.vc.channelId, targetId, interaction.client);

  await interaction.update({
    content: `🔄 Ownership transferred to **${target.displayName}**.`,
    components: [],
  });
}

// ── Region ──

async function handleRegionSelect(
  interaction: StringSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const resolved = await resolveUserVC(interaction, member);
  if (!resolved) return;

  const selectedRegion = interaction.values[0];
  const region = selectedRegion === "auto" ? null : selectedRegion;

  const cooldown = checkRateLimit(resolved.vc.channelId, "region");
  if (cooldown > 0) {
    await interaction.update({
      content: `⏳ Rate limit active. Please wait **${cooldown}s** before changing region again.`,
      components: [],
    });
    return;
  }

  try {
    await resolved.channel.setRTCRegion(region);
    recordAction(resolved.vc.channelId, "region");
    await updateVCSettings(resolved.vc.channelId, { region });
    await interaction.update({
      content: `🌍 Voice region set to **${selectedRegion === "auto" ? "Automatic" : selectedRegion}**.`,
      components: [],
    });
  } catch {
    await interaction.update({
      content: "❌ Failed to set voice region.",
      components: [],
    });
  }
}

// ── Approve Waiting ──

async function handleApproveWaiting(
  interaction: UserSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const vc = getVCByOwner(interaction.guildId!, member.id);
  if (!vc || vc.ownerId !== member.id) {
    await interaction.update({
      content: "❌ You don't own a voice channel.",
      components: [],
    });
    return;
  }

  const channel = interaction.guild!.channels.cache.get(vc.channelId) as
    | VoiceChannel
    | undefined;
  if (!channel) {
    await interaction.update({
      content: "❌ Your voice channel no longer exists.",
      components: [],
    });
    return;
  }

  const approved: string[] = [];
  for (const userId of interaction.values) {
    const target = await interaction
      .guild!.members.fetch(userId)
      .catch(() => null);
    if (!target) continue;

    // Grant connect + view
    await channel.permissionOverwrites
      .edit(userId, { Connect: true, ViewChannel: true })
      .catch(() => null);

    // Move them into the VC from waiting room
    if (target.voice?.channelId) {
      await target.voice.setChannel(channel).catch(() => null);
    }

    await addPermitted(vc.channelId, userId);
    approved.push(target.displayName);
  }

  await interaction.update({
    content:
      approved.length > 0
        ? `✅ Approved and moved: **${approved.join(", ")}**`
        : "❌ No users could be approved.",
    components: [],
  });
}

// ── Request Join (from Waiting Room) ──

async function handleRequestJoin(
  interaction: StringSelectMenuInteraction,
  member: GuildMember,
): Promise<void> {
  const targetChannelId = interaction.values[0];
  const vc = getVCByChannel(targetChannelId);

  if (!vc) {
    await interaction.update({
      content: "❌ That voice channel is no longer active.",
      components: [],
    });
    return;
  }

  const owner = await interaction
    .guild!.members.fetch(vc.ownerId)
    .catch(() => null);
  if (!owner) {
    await interaction.update({
      content: "❌ Could not find the owner of that channel.",
      components: [],
    });
    return;
  }

  // Construct approval buttons
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`vc_req_approve_${member.id}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vc_req_deny_${member.id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
  );

  // Acknowledge the user
  await interaction.update({
    content: `✅ Request sent to **${owner.displayName}**. Please wait for them to act.`,
    components: [],
  });

  // Cleanup the selection message after 10s
  setTimeout(() => interaction.deleteReply().catch(() => null), 10000);

  // Send the request ping to the owner in the settings interface channel
  const config = getGuildConfig(interaction.guildId!);
  if (!config) return;

  const settingsChannel = interaction.guild!.channels.cache.get(
    config.settingsChannelId,
  ) as TextChannel | undefined;
  if (settingsChannel) {
    const reqMsg = await settingsChannel.send({
      content: `🔔 <@${owner.id}>, **${member.displayName}** in the Waiting Room is requesting to join your Voice Channel.`,
      components: [row],
    });

    // Auto-delete the request after 2 minutes if the owner ignores it
    setTimeout(() => reqMsg.delete().catch(() => null), 120000);
  }
}
