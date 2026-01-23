import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { MentionReaction } from "./models/MentionReaction";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const PREFIX = "!";

// --- 🚀 CACHE LAYER ---
// Key: "guildId_userId", Value: string[] (emojis)
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
    `🔗 Invite: https://discord.com/api/oauth2/authorize?client_id=${client.user?.id}&permissions=274878024768&scope=bot`,
  );

  // Hydrate Cache on Boot
  await loadCache();
});

// Database Connection
mongoose
  .connect(process.env.MONGODB_URI || "")
  .then(() => console.log("📦 Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // --- 1. OPTIMIZED REACTION LOGIC ---
  // ⚡ READ FROM MEMORY (0ms Latency, No DB Calls)
  if (message.guild && message.mentions.users.size > 0) {
    // Iterate strictly over the mentions
    for (const [userId, user] of message.mentions.users) {
      const key = `${message.guild.id}_${userId}`;
      const emojis = reactionCache.get(key);

      if (emojis && emojis.length > 0) {
        for (const emoji of emojis) {
          // Catch errors individually so one failure doesn't stop others
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
      // await message.reply(
      //   "❌ **Access Denied:** You are not authorized to manage reactions.",
      // );
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
        // 1. Update Database
        await MentionReaction.findOneAndUpdate(
          { guildId: message.guild!.id, triggerUserId: user.id },
          { $set: { emojis: emojis } },
          { upsert: true, new: true },
        );

        // 2. Update Cache INSTANTLY
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

      // Remove from Cache
      reactionCache.delete(`${message.guild!.id}_${user.id}`);

      await message.reply(`✅ Removed config for ${user.tag}.`);
    } else if (action === "list") {
      // Read from Cache to show current state
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

client.login(process.env.DISCORD_TOKEN);
