import {
  ChatInputCommandInteraction,
  GuildMember,
  VoiceChannel,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import {
  getVCByOwner,
  getVCByChannel,
  isVCOwner,
  updateVCSettings,
  addBanned,
  removeBanned,
  addPermitted,
  transferOwnership,
  claimVC,
  getModRoleIds,
  getBotRoleIds,
} from "./vcManager";

// ──────────────────────────────────────────────
// 🎙️  /vc — Slash command subcommand handler
// ──────────────────────────────────────────────

export async function handleVCCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const member = interaction.member as GuildMember;

  // For claim, no ownership check
  if (subcommand === "claim") {
    return handleClaimCmd(interaction, member);
  }

  // For drag, no ownership check (but mod verification done inside)
  if (subcommand === "drag") {
    return handleDragCmd(interaction, member);
  }

  // Find user's VC
  const vc = getVCByOwner(interaction.guildId!, member.id);
  if (!vc || vc.ownerId !== member.id) {
    await interaction.reply({
      content:
        "❌ You don't own a voice channel. Join **Join to Create** first!",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.guild!.channels.cache.get(vc.channelId) as
    | VoiceChannel
    | undefined;
  if (!channel) {
    await interaction.reply({
      content: "❌ Your voice channel no longer exists.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (subcommand) {
    case "lock":
      await channel.permissionOverwrites.edit(interaction.guild!.id, {
        Connect: false,
      });
      for (const roleId of [...getBotRoleIds(), ...getModRoleIds()]) {
        await channel.permissionOverwrites
          .edit(roleId, { Connect: true, ViewChannel: true })
          .catch(() => null);
      }
      await updateVCSettings(vc.channelId, { locked: true });
      await interaction.reply({
        content: "🔒 Channel **locked**.",
        flags: MessageFlags.Ephemeral,
      });
      break;

    case "unlock":
      await channel.permissionOverwrites.edit(interaction.guild!.id, {
        Connect: null,
      });
      await updateVCSettings(vc.channelId, { locked: false });
      await interaction.reply({
        content: "🔓 Channel **unlocked**.",
        flags: MessageFlags.Ephemeral,
      });
      break;

    case "hide":
      await channel.permissionOverwrites.edit(interaction.guild!.id, {
        ViewChannel: false,
      });
      for (const roleId of [...getBotRoleIds(), ...getModRoleIds()]) {
        await channel.permissionOverwrites
          .edit(roleId, { Connect: true, ViewChannel: true })
          .catch(() => null);
      }
      await updateVCSettings(vc.channelId, { hidden: true });
      await interaction.reply({
        content: "👁️ Channel **hidden**.",
        flags: MessageFlags.Ephemeral,
      });
      break;

    case "unhide":
      await channel.permissionOverwrites.edit(interaction.guild!.id, {
        ViewChannel: null,
      });
      await updateVCSettings(vc.channelId, { hidden: false });
      await interaction.reply({
        content: "👀 Channel **visible**.",
        flags: MessageFlags.Ephemeral,
      });
      break;

    case "limit": {
      const limit = interaction.options.getInteger("count") ?? 0;
      if (limit < 0 || limit > 99) {
        await interaction.reply({
          content: "❌ Limit must be 0-99.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await channel.setUserLimit(limit);
      await updateVCSettings(vc.channelId, { userLimit: limit });
      await interaction.reply({
        content:
          limit === 0
            ? "🔢 Limit **removed**."
            : `🔢 Limit set to **${limit}**.`,
        flags: MessageFlags.Ephemeral,
      });
      break;
    }

    case "invite": {
      const target = interaction.options.getUser("user", true);
      await channel.permissionOverwrites.edit(target.id, {
        Connect: true,
        ViewChannel: true,
      });
      await addPermitted(vc.channelId, target.id);
      await interaction.reply({
        content: `✉️ ${target} has been **invited**.`,
        flags: MessageFlags.Ephemeral,
      });
      break;
    }

    case "ban": {
      const target = interaction.options.getUser("user", true);
      if (target.id === member.id) {
        await interaction.reply({
          content: "❌ Can't ban yourself.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await channel.permissionOverwrites.edit(target.id, { Connect: false });
      await addBanned(vc.channelId, target.id);
      const targetMember = await interaction
        .guild!.members.fetch(target.id)
        .catch(() => null);
      if (targetMember?.voice?.channelId === vc.channelId) {
        await targetMember.voice
          .disconnect("Banned by VC owner")
          .catch(() => null);
      }
      await interaction.reply({
        content: `🚫 ${target} has been **banned**.`,
        flags: MessageFlags.Ephemeral,
      });
      break;
    }

    case "permit": {
      const target = interaction.options.getUser("user", true);
      await channel.permissionOverwrites.delete(target.id).catch(() => null);
      await channel.permissionOverwrites.edit(target.id, {
        Connect: true,
        ViewChannel: true,
      });
      await removeBanned(vc.channelId, target.id);
      await addPermitted(vc.channelId, target.id);
      await interaction.reply({
        content: `✅ ${target} has been **permitted**.`,
        flags: MessageFlags.Ephemeral,
      });
      break;
    }

    case "rename": {
      const name = interaction.options.getString("name", true);
      try {
        await channel.setName(name);
        await interaction.reply({
          content: `✏️ Renamed to **${name}**.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        await interaction.reply({
          content:
            "❌ Failed. Discord rate-limits name changes (2 per 10 min).",
          flags: MessageFlags.Ephemeral,
        });
      }
      break;
    }

    case "bitrate": {
      const kbps = interaction.options.getInteger("kbps", true);
      if (kbps < 8 || kbps > 384) {
        await interaction.reply({
          content: "❌ Bitrate: 8-384 kbps.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      try {
        await channel.setBitrate(kbps * 1000);
        await updateVCSettings(vc.channelId, { bitrate: kbps });
        await interaction.reply({
          content: `🎵 Bitrate set to **${kbps}kbps**.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        await interaction.reply({
          content: "❌ Failed — server may need Boost for higher bitrates.",
          flags: MessageFlags.Ephemeral,
        });
      }
      break;
    }

    case "region": {
      const region = interaction.options.getString("region", true);
      const actualRegion = region === "auto" ? null : region;
      try {
        await channel.setRTCRegion(actualRegion);
        await updateVCSettings(vc.channelId, { region: actualRegion });
        await interaction.reply({
          content: `🌍 Region set to **${region === "auto" ? "Automatic" : region}**.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        await interaction.reply({
          content: "❌ Failed to set region.",
          flags: MessageFlags.Ephemeral,
        });
      }
      break;
    }

    case "transfer": {
      const target = interaction.options.getUser("user", true);
      if (target.id === member.id) {
        await interaction.reply({
          content: "❌ You already own this.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const targetMember = await interaction
        .guild!.members.fetch(target.id)
        .catch(() => null);
      if (targetMember?.voice?.channelId !== vc.channelId) {
        await interaction.reply({
          content: "❌ User must be in your VC to transfer.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await transferOwnership(vc.channelId, target.id, interaction.client);
      await interaction.reply({
        content: `🔄 Ownership transferred to **${target}**.`,
        flags: MessageFlags.Ephemeral,
      });
      break;
    }

    default:
      await interaction.reply({
        content: "❌ Unknown subcommand.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

async function handleClaimCmd(
  interaction: ChatInputCommandInteraction,
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
      content: "👑 You have **claimed** ownership!",
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: "❌ Cannot claim — the owner is still in the channel.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ── Drag Cmd ──

async function handleDragCmd(
  interaction: ChatInputCommandInteraction,
  member: GuildMember,
): Promise<void> {
  const isMod =
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.some((role) => getModRoleIds().includes(role.id));

  if (!isMod) {
    await interaction.reply({
      content:
        "❌ You must be an Administrator or a Moderator to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetChannel = member.voice.channel;
  if (!targetChannel) {
    await interaction.reply({
      content: "❌ You must be in a voice channel first to drag users into it.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sourceChannelId = interaction.options.getChannel("channel", true).id;
  const sourceChannel = interaction.guild!.channels.cache.get(sourceChannelId);

  if (!sourceChannel || !sourceChannel.isVoiceBased()) {
    await interaction.reply({
      content: "❌ Invalid source channel selected.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sourceChannel.id === targetChannel.id) {
    await interaction.reply({
      content: "❌ You cannot drag users from your own channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get members to move
  const membersToMove = sourceChannel.members.filter((m) => !m.user.bot);

  if (membersToMove.size === 0) {
    await interaction.reply({
      content: "❌ The selected channel is empty (or only contains bots).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let movedCount = 0;
  for (const [memberId, m] of membersToMove) {
    if (m.voice && m.voice.channelId === sourceChannel.id) {
      try {
        await m.voice.setChannel(targetChannel);
        movedCount++;
      } catch (err) {
        console.error(`Attempt to move user ${memberId} failed:`, err);
      }
    }
  }

  await interaction.editReply({
    content: `✅ Successfully dragged **${movedCount}** user(s) into your channel.`,
  });
}
