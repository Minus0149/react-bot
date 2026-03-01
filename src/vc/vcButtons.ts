import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
  VoiceChannel,
  GuildMember,
  PermissionsBitField,
  ChannelType,
} from "discord.js";
import {
  getVCByChannel,
  getVCByOwner,
  isVCOwner,
  updateVCSettings,
  addBanned,
  getModRoleIds,
  getBotRoleIds,
  removeBanned,
  addPermitted,
  transferOwnership,
  claimVC,
  VCData,
} from "./vcManager";

// ──────────────────────────────────────────────
// 🎛️  VC BUTTONS — Interaction handlers
// ──────────────────────────────────────────────

const VC_BUTTON_IDS = [
  "vc_lock",
  "vc_unlock",
  "vc_hide",
  "vc_unhide",
  "vc_limit",
  "vc_invite",
  "vc_ban",
  "vc_permit",
  "vc_rename",
  "vc_bitrate",
  "vc_region",
  "vc_claim",
  "vc_transfer",
  "vc_info",
  "vc_waiting",
];

export function isVCButton(customId: string): boolean {
  if (
    customId.startsWith("vc_req_approve_") ||
    customId.startsWith("vc_req_deny_")
  ) {
    return true;
  }
  return VC_BUTTON_IDS.includes(customId);
}

export async function handleVCButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember;
  if (!member) {
    await interaction.reply({
      content: "❌ Could not resolve your membership.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Find the user's VC — they must be in one (or own one)
  const voiceChannelId = member.voice?.channelId;
  let vc: VCData | undefined;

  if (voiceChannelId) {
    vc = getVCByChannel(voiceChannelId);
  }
  if (!vc) {
    vc = getVCByOwner(interaction.guildId!, member.id);
  }

  // Special case: Claim doesn't require ownership
  if (interaction.customId === "vc_claim") {
    return handleClaim(interaction, member);
  }

  // Special case: Info doesn't require ownership
  if (interaction.customId === "vc_info") {
    return handleInfo(interaction, member, vc);
  }

  // Special case: Waiting doesn't require ownership (shows waiting room info)
  if (interaction.customId === "vc_waiting") {
    return handleWaiting(interaction, member, vc);
  }

  // Special case: Request approvals
  if (interaction.customId.startsWith("vc_req_approve_")) {
    return handleReqApprove(interaction, member, vc);
  }
  if (interaction.customId.startsWith("vc_req_deny_")) {
    return handleReqDeny(interaction, member, vc);
  }

  if (!vc) {
    await interaction.reply({
      content:
        "❌ You don't have an active voice channel. Join **Join to Create** first!",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Ownership check
  if (vc.ownerId !== member.id) {
    await interaction.reply({
      content:
        "❌ You don't own this voice channel. Only the owner can manage it.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild!;
  const channel = guild.channels.cache.get(vc.channelId) as
    | VoiceChannel
    | undefined;

  if (!channel) {
    await interaction.reply({
      content: "❌ Your voice channel no longer exists.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (interaction.customId) {
    case "vc_lock":
      return handleLock(interaction, channel, vc);
    case "vc_unlock":
      return handleUnlock(interaction, channel, vc);
    case "vc_hide":
      return handleHide(interaction, channel, vc);
    case "vc_unhide":
      return handleUnhide(interaction, channel, vc);
    case "vc_limit":
      return handleLimitModal(interaction);
    case "vc_invite":
      return handleInviteMenu(interaction, channel);
    case "vc_ban":
      return handleBanMenu(interaction, channel);
    case "vc_permit":
      return handlePermitMenu(interaction, channel, vc);
    case "vc_rename":
      return handleRenameModal(interaction);
    case "vc_bitrate":
      return handleBitrateModal(interaction);
    case "vc_region":
      return handleRegionMenu(interaction);
    case "vc_transfer":
      return handleTransferMenu(interaction, channel);
    default:
      await interaction.reply({
        content: "❌ Unknown action.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

// ── Lock / Unlock ──

async function handleLock(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
  vc: VCData,
): Promise<void> {
  await channel.permissionOverwrites.edit(interaction.guild!.id, {
    Connect: false,
  });
  // Preserve access for bot + mod roles
  for (const roleId of [...getBotRoleIds(), ...getModRoleIds()]) {
    await channel.permissionOverwrites
      .edit(roleId, { Connect: true, ViewChannel: true })
      .catch(() => null);
  }
  await updateVCSettings(vc.channelId, { locked: true });
  await interaction.reply({
    content:
      "🔒 Your voice channel has been **locked**. No one can join unless permitted.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUnlock(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
  vc: VCData,
): Promise<void> {
  await channel.permissionOverwrites.edit(interaction.guild!.id, {
    Connect: null,
  });
  await updateVCSettings(vc.channelId, { locked: false });
  await interaction.reply({
    content: "🔓 Your voice channel has been **unlocked**. Anyone can join.",
    flags: MessageFlags.Ephemeral,
  });
}

// ── Hide / Unhide ──

async function handleHide(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
  vc: VCData,
): Promise<void> {
  await channel.permissionOverwrites.edit(interaction.guild!.id, {
    ViewChannel: false,
  });
  // Preserve visibility for bot + mod roles
  for (const roleId of [...getBotRoleIds(), ...getModRoleIds()]) {
    await channel.permissionOverwrites
      .edit(roleId, { Connect: true, ViewChannel: true })
      .catch(() => null);
  }
  await updateVCSettings(vc.channelId, { hidden: true });
  await interaction.reply({
    content: "👁️ Your voice channel is now **hidden** from the channel list.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUnhide(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
  vc: VCData,
): Promise<void> {
  await channel.permissionOverwrites.edit(interaction.guild!.id, {
    ViewChannel: null,
  });
  await updateVCSettings(vc.channelId, { hidden: false });
  await interaction.reply({
    content: "👀 Your voice channel is now **visible** to everyone.",
    flags: MessageFlags.Ephemeral,
  });
}

// ── Limit (Modal) ──

async function handleLimitModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("vc_modal_limit")
    .setTitle("Set User Limit");

  const input = new TextInputBuilder()
    .setCustomId("limit_value")
    .setLabel("User limit (0 = unlimited)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 5")
    .setMaxLength(3)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

// ── Invite (User Select) ──

async function handleInviteMenu(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
): Promise<void> {
  const selectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("vc_select_invite")
      .setPlaceholder("Select a user to invite")
      .setMinValues(1)
      .setMaxValues(1),
  );

  await interaction.reply({
    content: "✉️ Select a user to **invite** to your voice channel:",
    components: [selectRow],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Ban (User Select) ──

async function handleBanMenu(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
): Promise<void> {
  const selectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("vc_select_ban")
      .setPlaceholder("Select a user to ban")
      .setMinValues(1)
      .setMaxValues(1),
  );

  await interaction.reply({
    content: "🚫 Select a user to **ban** from your voice channel:",
    components: [selectRow],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Permit (User Select) ──

async function handlePermitMenu(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
  vc: VCData,
): Promise<void> {
  const selectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("vc_select_permit")
      .setPlaceholder("Select a user to permit")
      .setMinValues(1)
      .setMaxValues(1),
  );

  await interaction.reply({
    content: "✅ Select a user to **permit** (unban + grant access):",
    components: [selectRow],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Rename (Modal) ──

async function handleRenameModal(
  interaction: ButtonInteraction,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("vc_modal_rename")
    .setTitle("Rename Voice Channel");

  const input = new TextInputBuilder()
    .setCustomId("rename_value")
    .setLabel("New channel name")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("My awesome channel")
    .setMaxLength(100)
    .setMinLength(1)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

// ── Bitrate (Modal) ──

async function handleBitrateModal(
  interaction: ButtonInteraction,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("vc_modal_bitrate")
    .setTitle("Set Bitrate");

  const input = new TextInputBuilder()
    .setCustomId("bitrate_value")
    .setLabel("Bitrate in kbps (8-384)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 96")
    .setMaxLength(3)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

// ── Region (Select Menu) ──

const VOICE_REGIONS = [
  { label: "Auto", value: "auto", emoji: "🌐" },
  { label: "US West", value: "us-west", emoji: "🇺🇸" },
  { label: "US East", value: "us-east", emoji: "🇺🇸" },
  { label: "US Central", value: "us-central", emoji: "🇺🇸" },
  { label: "US South", value: "us-south", emoji: "🇺🇸" },
  { label: "Singapore", value: "singapore", emoji: "🇸🇬" },
  { label: "South Africa", value: "southafrica", emoji: "🇿🇦" },
  { label: "Sydney", value: "sydney", emoji: "🇦🇺" },
  { label: "Europe", value: "europe", emoji: "🇪🇺" },
  { label: "Brazil", value: "brazil", emoji: "🇧🇷" },
  { label: "Hong Kong", value: "hongkong", emoji: "🇭🇰" },
  { label: "Russia", value: "russia", emoji: "🇷🇺" },
  { label: "Japan", value: "japan", emoji: "🇯🇵" },
  { label: "India", value: "india", emoji: "🇮🇳" },
];

async function handleRegionMenu(interaction: ButtonInteraction): Promise<void> {
  const selectRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("vc_select_region")
        .setPlaceholder("Select a voice region")
        .addOptions(
          VOICE_REGIONS.map((r) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(r.label)
              .setValue(r.value)
              .setEmoji(r.emoji),
          ),
        ),
    );

  await interaction.reply({
    content: "🌍 Select a **voice region** for your channel:",
    components: [selectRow],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Transfer (User Select) ──

async function handleTransferMenu(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
): Promise<void> {
  const selectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("vc_select_transfer")
      .setPlaceholder("Select the new owner")
      .setMinValues(1)
      .setMaxValues(1),
  );

  await interaction.reply({
    content: "🔄 Select a user to **transfer ownership** to:",
    components: [selectRow],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Claim ──

async function handleClaim(
  interaction: ButtonInteraction,
  member: GuildMember,
): Promise<void> {
  const voiceChannelId = member.voice?.channelId;
  if (!voiceChannelId) {
    await interaction.reply({
      content: "❌ You must be in a voice channel to claim it.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const vc = getVCByChannel(voiceChannelId);
  if (!vc) {
    await interaction.reply({
      content: "❌ This is not a managed voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (vc.ownerId === member.id) {
    await interaction.reply({
      content: "👑 You already own this channel!",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const success = await claimVC(voiceChannelId, member.id, interaction.client);
  if (success) {
    await interaction.reply({
      content: "👑 You have **claimed** ownership of this voice channel!",
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: "❌ Cannot claim — the owner is still in the channel.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ── Info ──

async function handleInfo(
  interaction: ButtonInteraction,
  member: GuildMember,
  vc: VCData | undefined,
): Promise<void> {
  if (!vc) {
    await interaction.reply({
      content: "❌ You don't have an active voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.guild!.channels.cache.get(vc.channelId) as
    | VoiceChannel
    | undefined;
  const ownerUser = await interaction.client.users
    .fetch(vc.ownerId)
    .catch(() => null);

  const info = [
    `**Channel:** ${channel?.name || "Unknown"}`,
    `**Owner:** ${ownerUser?.tag || vc.ownerId}`,
    `**Locked:** ${vc.settings.locked ? "Yes 🔒" : "No 🔓"}`,
    `**Hidden:** ${vc.settings.hidden ? "Yes 👁️" : "No 👀"}`,
    `**User Limit:** ${vc.settings.userLimit || "Unlimited"}`,
    `**Bitrate:** ${vc.settings.bitrate}kbps`,
    `**Region:** ${vc.settings.region || "Auto"}`,
    `**Banned:** ${vc.banned.length > 0 ? vc.banned.map((id) => `<@${id}>`).join(", ") : "None"}`,
    `**Members:** ${channel?.members.size || 0}`,
  ].join("\n");

  await interaction.reply({
    content: `ℹ️ **Voice Channel Info**\n\n${info}`,
    flags: MessageFlags.Ephemeral,
  });
}

// ── WAITING ROOM ──

async function handleWaiting(
  interaction: ButtonInteraction,
  member: GuildMember,
  vc: VCData | undefined,
): Promise<void> {
  if (!vc || vc.ownerId !== member.id) {
    await interaction.reply({
      content: "❌ You need to own a voice channel to check the waiting room.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild!;

  // Find the waiting room channel from guild config
  const { getGuildConfig } = await import("./vcManager");
  const config = getGuildConfig(guild.id);
  if (!config || !config.waitingRoomId) {
    await interaction.reply({
      content: "❌ No waiting room configured for this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const waitingRoom = guild.channels.cache.get(config.waitingRoomId) as
    | VoiceChannel
    | undefined;

  if (!waitingRoom) {
    await interaction.reply({
      content: "❌ Waiting room channel not found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const waitingMembers = waitingRoom.members;

  if (waitingMembers.size === 0) {
    await interaction.reply({
      content: "⏳ **Waiting Room** — Nobody is waiting right now.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const memberList = waitingMembers
    .map((m) => `<@${m.id}> (${m.displayName})`)
    .join("\n");

  const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("vc_approve_waiting")
      .setPlaceholder("Select a user to let into your VC")
      .setMinValues(1)
      .setMaxValues(Math.min(waitingMembers.size, 25)),
  );

  await interaction.reply({
    content: `⏳ **Waiting Room** — ${waitingMembers.size} user(s) waiting:\n\n${memberList}\n\nSelect who to let in:`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Join Requests ──

async function handleReqApprove(
  interaction: ButtonInteraction,
  member: GuildMember,
  vc: VCData | undefined,
): Promise<void> {
  if (!vc || vc.ownerId !== member.id) {
    await interaction.reply({
      content: "❌ You don't own a voice channel to approve this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetId = interaction.customId.replace("vc_req_approve_", "");
  const target = await interaction
    .guild!.members.fetch(targetId)
    .catch(() => null);

  if (!target) {
    await interaction.update({
      content: "❌ That user is no longer in the server.",
      components: [],
    });
    setTimeout(() => interaction.deleteReply().catch(() => null), 10000);
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
    setTimeout(() => interaction.deleteReply().catch(() => null), 10000);
    return;
  }

  // Grant permissions and move
  await channel.permissionOverwrites
    .edit(targetId, { Connect: true, ViewChannel: true })
    .catch(() => null);
  await addPermitted(vc.channelId, targetId);

  if (target.voice?.channelId) {
    await target.voice.setChannel(channel).catch(() => null);
  }

  await interaction.update({
    content: `✅ You approved **${target.displayName}**'s request. They have been moved in.`,
    components: [],
  });
  setTimeout(() => interaction.deleteReply().catch(() => null), 10000);
}

async function handleReqDeny(
  interaction: ButtonInteraction,
  member: GuildMember,
  vc: VCData | undefined,
): Promise<void> {
  if (!vc || vc.ownerId !== member.id) {
    await interaction.reply({
      content: "❌ You don't own a voice channel to deny this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetId = interaction.customId.replace("vc_req_deny_", "");
  const target = await interaction
    .guild!.members.fetch(targetId)
    .catch(() => null);

  await interaction.update({
    content: `❌ You denied **${target?.displayName || "the user"}**'s request.`,
    components: [],
  });
  setTimeout(() => interaction.deleteReply().catch(() => null), 10000);
}
