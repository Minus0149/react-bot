import {
  ChatInputCommandInteraction,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  MessageFlags,
  GuildMember,
  TextChannel,
} from "discord.js";
import { GuildVC } from "../models/GuildVC";
import { setGuildConfig, getGuildConfig, deleteGuildConfig } from "./vcManager";
import { buildVCPanelEmbed, buildVCPanelRows } from "./vcPanel";

// ──────────────────────────────────────────────
// ⚙️  /setup — Creates the VC system for a guild
// ──────────────────────────────────────────────

export async function handleSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember;

  // Permission check: ManageGuild
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "❌ You need **Manage Server** permission to run this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if already set up — verify if channels still exist
  const existing = getGuildConfig(interaction.guildId!);
  if (existing) {
    const categoryExists = interaction.guild!.channels.cache.has(
      existing.categoryId,
    );

    // If the category was deleted manually, clean up the database config and proceed with a fresh setup
    if (!categoryExists) {
      await deleteGuildConfig(interaction.guildId!);
      // Continue to fresh setup below...
    } else {
      const lines = [
        "⚠️ **VC system is already configured in this server.**\n",
        `📁 **Category:** <#${existing.categoryId}>`,
        `🎙️ **Join to Create:** <#${existing.joinToCreateId}>`,
        `⏳ **Waiting Room:** <#${existing.waitingRoomId}>`,
        `📝 **Interface:** <#${existing.settingsChannelId}>`,
        "",
        "To re-setup, delete the **vc-settings** category first, then run `/setup` again.",
      ];
      await interaction.reply({
        content: lines.join("\n"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild!;
  const botMember = guild.members.me!;

  // ── Pre-flight permission check ──
  const perms = botMember.permissions;
  console.log(
    `[Setup] Bot role position: ${botMember.roles.highest.position}/${guild.roles.cache.size}`,
  );
  console.log(
    `[Setup] ManageChannels: ${perms.has(PermissionFlagsBits.ManageChannels)}`,
  );
  console.log(
    `[Setup] ManageRoles: ${perms.has(PermissionFlagsBits.ManageRoles)}`,
  );
  console.log(
    `[Setup] ManageGuild: ${perms.has(PermissionFlagsBits.ManageGuild)}`,
  );
  console.log(
    `[Setup] Administrator: ${perms.has(PermissionFlagsBits.Administrator)}`,
  );
  console.log(
    `[Setup] ViewChannel: ${perms.has(PermissionFlagsBits.ViewChannel)}`,
  );

  if (!perms.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.editReply({
      content:
        "❌ Bot is missing **Manage Channels** permission. Please check the bot's role in Server Settings → Roles.",
    });
    return;
  }

  try {
    // 1. Create category — no custom overwrites (bot inherits guild-level perms)
    console.log(`[Setup] Creating category in guild ${guild.id}...`);
    const category = await guild.channels.create({
      name: "vc-settings",
      type: ChannelType.GuildCategory,
    });

    // 2. Create "Join to Create" VC
    const joinToCreate = await guild.channels.create({
      name: "Join to Create",
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: 1,
    });

    // 3. Create "waiting room" VC
    const waitingRoom = await guild.channels.create({
      name: "waiting room",
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: 5,
    });

    // 4. Create settings text channel
    const settingsChannel = await guild.channels.create({
      name: "vc-interface",
      type: ChannelType.GuildText,
      parent: category.id,
    });

    // 5. Send control panel embed FIRST (before locking the channel)
    const embed = buildVCPanelEmbed();
    const rows = buildVCPanelRows();

    const panelMessage = await settingsChannel.send({
      embeds: [embed],
      components: rows,
    });

    // 6. NOW lock the channel so only the bot can send messages
    await settingsChannel.permissionOverwrites
      .edit(guild.id, { SendMessages: false })
      .catch(() => null);
    await settingsChannel.permissionOverwrites
      .edit(botMember.id, { SendMessages: true })
      .catch(() => null);

    // 6. Save to database
    const config = await GuildVC.create({
      guildId: guild.id,
      categoryId: category.id,
      joinToCreateId: joinToCreate.id,
      waitingRoomId: waitingRoom.id,
      settingsChannelId: settingsChannel.id,
      interfaceMessageId: panelMessage.id,
    });

    // Update cache
    await setGuildConfig(config);

    await interaction.editReply({
      content:
        "✅ **VC System setup complete!**\n\n" +
        `📁 Category: ${category.name}\n` +
        `🎙️ Join to Create: ${joinToCreate.name}\n` +
        `⏳ Waiting Room: ${waitingRoom.name}\n` +
        `📝 Interface: ${settingsChannel.name}\n\n` +
        "Users can now join **Join to Create** to get their own voice channel!",
    });
  } catch (error: any) {
    console.error("[VC Setup] Error:", error);
    const code = error?.code || "unknown";
    const msg = error?.rawError?.message || error?.message || "Unknown error";
    await interaction.editReply({
      content: `❌ Failed to set up VC system.\n\n**Error:** \`${code}\` — ${msg}\n\nMake sure the bot has **Manage Channels** permission and its role is not at the very bottom of the role list.`,
    });
  }
}

// ──────────────────────────────────────────────
// 🔄  UPDATE PANEL COMMAND
// ──────────────────────────────────────────────

export async function handleUpdatePanel(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const existing = getGuildConfig(guild.id);
  if (!existing) {
    await interaction.reply({
      content:
        "❌ The VC system is not set up in this server yet. Run `/setup` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settingsChannel = guild.channels.cache.get(
    existing.settingsChannelId,
  ) as TextChannel | undefined;
  if (!settingsChannel) {
    await interaction.reply({
      content:
        "❌ Could not find the interface channel. You may need to run `/setup` again if the category was deleted.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Buld fresh panel
    const embed = buildVCPanelEmbed();
    const rows = buildVCPanelRows();

    // Send new panel inside the settings channel
    const panelMessage = await settingsChannel.send({
      embeds: [embed],
      components: rows,
    });

    // We don't necessarily have to delete the old one, but we update the DB so the system knows the new ID
    await GuildVC.findOneAndUpdate(
      { guildId: guild.id },
      { interfaceMessageId: panelMessage.id },
    );

    // Update cache
    existing.interfaceMessageId = panelMessage.id;
    await setGuildConfig(existing);

    await interaction.editReply({
      content:
        "✅ **Panel successfully updated!** A fresh VC interface has been posted.",
    });
  } catch (error: any) {
    console.error("[VC Update] Error:", error);
    await interaction.editReply({
      content: `❌ Failed to update the panel. Make sure the bot has permissions to send messages in <#${existing.settingsChannelId}>.`,
    });
  }
}
