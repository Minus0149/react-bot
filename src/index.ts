import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Events,
  MessageFlags,
} from "discord.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { MentionReaction } from "./models/MentionReaction";
import {
  initVCSystem,
  handleVoiceStateUpdate,
  handleChannelDelete,
} from "./vc/vcManager";
import { isVCButton, handleVCButton } from "./vc/vcButtons";
import { isVCModal, handleVCModal } from "./vc/vcModals";
import { isVCSelectMenu, handleVCSelectMenu } from "./vc/vcSelectMenus";
import { handleSetupCommand, handleUpdatePanel } from "./vc/vcSetup";
import { handleVCCommand } from "./vc/vcCommands";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const PREFIX = "!";

// --- 🚀 CACHE LAYER ---
const reactionCache = new Map<string, string[]>();

async function loadCache() {
  console.log("🔄 Loading Reaction Cache...");
  const start = Date.now();
  try {
    const allConfigs = await MentionReaction.find({});
    reactionCache.clear();
    for (const config of allConfigs) {
      reactionCache.set(
        `${config.guildId}_${config.triggerUserId}`,
        config.emojis,
      );
    }
    console.log(
      `✅ Cache Hot: ${reactionCache.size} configs loaded in ${Date.now() - start}ms`,
    );
  } catch (e) {
    console.error("❌ Failed to load cache:", e);
  }
}

client.once("ready", async () => {
  console.log(`🤖 ReactBot is online as ${client.user?.tag}`);
  console.log(
    `🔗 Invite: https://discord.com/api/oauth2/authorize?client_id=${client.user?.id}&permissions=301288528&scope=bot%20applications.commands`,
  );

  // Hydrate Cache on Boot
  await loadCache();

  // Initialize VC System
  await initVCSystem(client);
});

// ══════════════════════════════════════════════
// STARTUP — Connect DB first, then login
// ══════════════════════════════════════════════

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "");
    console.log("📦 Connected to MongoDB");
  } catch (err) {
    console.error("⚠️ MongoDB connection failed — bot will still start:", err);
  }

  await client.login(process.env.DISCORD_TOKEN);
}

start();
// ══════════════════════════════════════════════

client.on(Events.InteractionCreate, async (interaction) => {
  console.log(
    `[Interaction] Type: ${interaction.type}, ${interaction.isChatInputCommand() ? `Command: ${(interaction as any).commandName}` : `CustomId: ${(interaction as any).customId || "N/A"}`}`,
  );
  try {
    // ── Slash Commands ──
    if (interaction.isChatInputCommand()) {
      console.log(
        `[Interaction] Handling slash command: ${interaction.commandName}`,
      );
      switch (interaction.commandName) {
        case "setup":
          await handleSetupCommand(interaction);
          break;
        case "vc_update":
          await handleUpdatePanel(interaction);
          break;
        case "vc":
          await handleVCCommand(interaction);
          break;
        default:
          console.log(
            `[Interaction] Unknown command: ${interaction.commandName}`,
          );
          break;
      }
      return;
    }

    // ── Button Presses ──
    if (interaction.isButton()) {
      if (isVCButton(interaction.customId)) {
        await handleVCButton(interaction);
      }
      return;
    }

    // ── Modal Submissions ──
    if (interaction.isModalSubmit()) {
      if (isVCModal(interaction.customId)) {
        await handleVCModal(interaction);
      }
      return;
    }

    // ── Select Menus (String + User + Role) ──
    if (
      interaction.isStringSelectMenu() ||
      interaction.isUserSelectMenu() ||
      interaction.isRoleSelectMenu()
    ) {
      if (isVCSelectMenu(interaction.customId)) {
        await handleVCSelectMenu(interaction);
      }
      return;
    }
  } catch (error) {
    console.error("[Interaction] Error:", error);
    try {
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "❌ Something went wrong.",
            flags: MessageFlags.Ephemeral,
          } as any);
        } else {
          await interaction.reply({
            content: "❌ Something went wrong.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    } catch {
      // Ignore follow-up errors
    }
  }
});

// ══════════════════════════════════════════════
// VOICE STATE UPDATE — Join-to-Create + Auto-Delete
// ══════════════════════════════════════════════

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  await handleVoiceStateUpdate(oldState, newState, client);
});

// ══════════════════════════════════════════════
// CHANNEL DELETE — Cleanup orphaned temp VCs
// ══════════════════════════════════════════════

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.isDMBased()) {
    await handleChannelDelete(channel);
  }
});

// ══════════════════════════════════════════════
// MESSAGE CREATE — Prefix commands (reactions)
// ══════════════════════════════════════════════

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // --- 1. OPTIMIZED REACTION LOGIC ---
  if (message.guild && message.mentions.users.size > 0) {
    for (const [userId, user] of message.mentions.users) {
      const key = `${message.guild.id}_${userId}`;
      const emojis = reactionCache.get(key);

      if (emojis && emojis.length > 0) {
        for (const emoji of emojis) {
          message.react(emoji).catch(() => null);
        }
      }
    }
  }

  // --- 2. COMMAND LOGIC (!reactmention) ---
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift()?.toLowerCase();

  if (commandName === "reactmention") {
    // Permission Check: Whitelist Logic from .env
    const allowedIds = (process.env.ALLOWED_USER_IDS || "")
      .split(",")
      .map((id) => id.trim());

    if (!allowedIds.includes(message.author.id)) {
      return;
    }

    const action = args[0]?.toLowerCase();

    if (action === "add") {
      const user = message.mentions.users.first();
      const emojis = args.slice(2);

      if (!user || emojis.length === 0) {
        await message.reply("Usage: `!reactmention add @User <emojis>`");
        return;
      }

      try {
        await MentionReaction.findOneAndUpdate(
          { guildId: message.guild!.id, triggerUserId: user.id },
          { $set: { emojis: emojis } },
          { upsert: true, new: true },
        );

        reactionCache.set(`${message.guild!.id}_${user.id}`, emojis);

        await message.reply(
          `✅ Configured reaction for ${user.tag}: ${emojis.join(" ")}`,
        );
      } catch (e) {
        await message.reply("❌ Database Error.");
      }
    } else if (action === "remove") {
      const user = message.mentions.users.first();
      if (!user) {
        await message.reply("Usage: `!reactmention remove @User`");
        return;
      }

      await MentionReaction.findOneAndDelete({
        guildId: message.guild!.id,
        triggerUserId: user.id,
      });

      reactionCache.delete(`${message.guild!.id}_${user.id}`);

      await message.reply(`✅ Removed config for ${user.tag}.`);
    } else if (action === "list") {
      const configs = await MentionReaction.find({
        guildId: message.guild!.id,
      });
      if (configs.length === 0) {
        await message.reply("ℹ️ No reactions set.");
        return;
      }
      const desc = configs
        .map((c) => `<@${c.triggerUserId}>: ${c.emojis.join(" ")}`)
        .join("\n");
      const embed = new EmbedBuilder()
        .setTitle("📝 Configured Reactions")
        .setDescription(desc)
        .setColor("#3498DB");
      await message.reply({ embeds: [embed] });
    } else {
      await message.reply("Usage: `!reactmention <add|remove|list>`");
    }
  }
});
