import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

// ──────────────────────────────────────────────
// 🎛️  VC PANEL — Astro-style Embed + Button Rows
// ──────────────────────────────────────────────

export function buildVCPanelEmbed(): EmbedBuilder {
  const description = [
    "**Manage your Custom Voice Channel using the buttons below!**",
    "You can also use `/vc` slash commands for everything here.\n",
    "🔒 **Lock** / 🔓 **Unlock** — Restrict who can join your channel.",
    "👁️ **Hide** / 👀 **Unhide** — Make your channel invisible to others.",
    "🔢 **Limit** — Set a maximum number of users allowed in.",
    "✉️ **Invite** — DM a user a direct invite link to join your VC.",
    "🚫 **Ban** / ✅ **Permit** — Block or allow specific users.",
    "✏️ **Rename** — Change your channel's name (2 per 10 mins).",
    "🎵 **Bitrate** / 🌍 **Region** — Adjust audio quality and routing.",
    "ℹ️ **Info** — View current settings and member counts.",
    "⏳ **Waiting** — View users in Waiting Room and let them in.",
    "👑 **Claim** — Take ownership if the current owner leaves.",
    "🔄 **Transfer** — Give ownership to someone else in the VC.",
  ].join("\n");

  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setAuthor({ name: "Voice Channel Interface" })
    .setDescription(description)
    .setFooter({ text: "Custom Voice Channels • Powered by NaraX" });
}

export function buildVCPanelRows(): ActionRowBuilder<ButtonBuilder>[] {
  // Row 1: Lock, Unlock, Hide, Unhide
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vc_lock")
      .setLabel("Lock")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_unlock")
      .setLabel("Unlock")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_hide")
      .setLabel("Hide")
      .setEmoji("👁️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_unhide")
      .setLabel("Unhide")
      .setEmoji("👀")
      .setStyle(ButtonStyle.Secondary),
  );

  // Row 2: Limit, Invite, Ban, Permit
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vc_limit")
      .setLabel("Limit")
      .setEmoji("🔢")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_invite")
      .setLabel("Invite")
      .setEmoji("✉️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_ban")
      .setLabel("Ban")
      .setEmoji("🚫")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_permit")
      .setLabel("Permit")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Secondary),
  );

  // Row 3: Rename, Bitrate, Region, Template
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vc_rename")
      .setLabel("Rename")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_bitrate")
      .setLabel("Bitrate")
      .setEmoji("🎵")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_region")
      .setLabel("Region")
      .setEmoji("🌍")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_info")
      .setLabel("Info")
      .setEmoji("ℹ️")
      .setStyle(ButtonStyle.Secondary),
  );

  // Row 4: Chat, Waiting, Claim, Transfer
  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vc_waiting")
      .setLabel("Waiting")
      .setEmoji("⏳")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vc_claim")
      .setLabel("Claim")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("vc_transfer")
      .setLabel("Transfer")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4];
}
