import {
  ModalSubmitInteraction,
  GuildMember,
  VoiceChannel,
  MessageFlags,
} from "discord.js";
import {
  getVCByOwner,
  isVCOwner,
  updateVCSettings,
  checkRateLimit,
  recordAction,
} from "./vcManager";

// ──────────────────────────────────────────────
// 📝  VC MODALS — Submit handlers
// ──────────────────────────────────────────────

const VC_MODAL_IDS = ["vc_modal_rename", "vc_modal_limit", "vc_modal_bitrate"];

export function isVCModal(customId: string): boolean {
  return VC_MODAL_IDS.includes(customId);
}

export async function handleVCModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember;
  if (!member) {
    await interaction.reply({
      content: "❌ Could not resolve your membership.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Find user's VC
  const vc = getVCByOwner(interaction.guildId!, member.id);
  if (!vc || vc.ownerId !== member.id) {
    await interaction.reply({
      content: "❌ You don't own a voice channel.",
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

  switch (interaction.customId) {
    case "vc_modal_rename":
      return handleRenameSubmit(interaction, channel, vc.channelId);
    case "vc_modal_limit":
      return handleLimitSubmit(interaction, channel, vc.channelId);
    case "vc_modal_bitrate":
      return handleBitrateSubmit(interaction, channel, vc.channelId);
    default:
      await interaction.reply({
        content: "❌ Unknown modal.",
        flags: MessageFlags.Ephemeral,
      });
  }
}

async function handleRenameSubmit(
  interaction: ModalSubmitInteraction,
  channel: VoiceChannel,
  channelId: string,
): Promise<void> {
  const name = interaction.fields.getTextInputValue("rename_value").trim();

  if (!name || name.length < 1 || name.length > 100) {
    await interaction.reply({
      content: "❌ Channel name must be between 1-100 characters.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cooldown = checkRateLimit(channelId, "rename");
  if (cooldown > 0) {
    await interaction.reply({
      content: `⏳ Discord rate-limits name changes (2 per 10 mins). Please wait **${Math.ceil(cooldown / 60)} minutes** before renaming again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await channel.setName(name);
    recordAction(channelId, "rename");
    await interaction.reply({
      content: `✏️ Channel renamed to **${name}**.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    await interaction.reply({
      content:
        "❌ Failed to rename. Discord may rate-limit name changes (2 per 10 min).",
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleLimitSubmit(
  interaction: ModalSubmitInteraction,
  channel: VoiceChannel,
  channelId: string,
): Promise<void> {
  const raw = interaction.fields.getTextInputValue("limit_value").trim();
  const limit = parseInt(raw, 10);

  if (isNaN(limit) || limit < 0 || limit > 99) {
    await interaction.reply({
      content:
        "❌ Limit must be a number between **0** (unlimited) and **99**.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await channel.setUserLimit(limit);
  await updateVCSettings(channelId, { userLimit: limit });
  await interaction.reply({
    content:
      limit === 0
        ? "🔢 User limit **removed** (unlimited)."
        : `🔢 User limit set to **${limit}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleBitrateSubmit(
  interaction: ModalSubmitInteraction,
  channel: VoiceChannel,
  channelId: string,
): Promise<void> {
  const raw = interaction.fields.getTextInputValue("bitrate_value").trim();
  const kbps = parseInt(raw, 10);

  if (isNaN(kbps) || kbps < 8 || kbps > 384) {
    await interaction.reply({
      content: "❌ Bitrate must be between **8** and **384** kbps.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cooldown = checkRateLimit(channelId, "bitrate");
  if (cooldown > 0) {
    await interaction.reply({
      content: `⏳ Rate limit active. Please wait **${cooldown}s** before changing bitrate again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await channel.setBitrate(kbps * 1000);
    recordAction(channelId, "bitrate");
    await updateVCSettings(channelId, { bitrate: kbps });
    await interaction.reply({
      content: `🎵 Bitrate set to **${kbps}kbps**.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    await interaction.reply({
      content:
        "❌ Failed to set bitrate. The server may not support this bitrate level (Boost required for higher values).",
      flags: MessageFlags.Ephemeral,
    });
  }
}
