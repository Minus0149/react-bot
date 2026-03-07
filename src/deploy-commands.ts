import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import dotenv from "dotenv";

dotenv.config();

// ──────────────────────────────────────────────
// 🚀  DEPLOY SLASH COMMANDS
// Run: bun run deploy
// ──────────────────────────────────────────────

const TOKEN = process.env.DISCORD_TOKEN!;

if (!TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

// Extract CLIENT_ID from the token (first segment is base64-encoded client ID)
const CLIENT_ID = Buffer.from(TOKEN.split(".")[0], "base64").toString();

// /setup command
const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Set up the Join-to-Create VC system for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// /vc_update command
const updatePanelCommand = new SlashCommandBuilder()
  .setName("vc_update")
  .setDescription("Resend the VC management panel embed")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// /vc command with subcommands
const vcCommand = new SlashCommandBuilder()
  .setName("vc")
  .setDescription("Manage your voice channel")
  .addSubcommand((sub) =>
    sub.setName("lock").setDescription("Lock your voice channel"),
  )
  .addSubcommand((sub) =>
    sub.setName("unlock").setDescription("Unlock your voice channel"),
  )
  .addSubcommand((sub) =>
    sub.setName("hide").setDescription("Hide your voice channel"),
  )
  .addSubcommand((sub) =>
    sub.setName("unhide").setDescription("Unhide your voice channel"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("limit")
      .setDescription("Set user limit")
      .addIntegerOption((opt) =>
        opt
          .setName("count")
          .setDescription("User limit (0 = unlimited)")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(99),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("invite")
      .setDescription("Invite a user to your VC")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to invite").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ban")
      .setDescription("Ban a user from your VC")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to ban").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("permit")
      .setDescription("Permit a user or role (unban + grant access)")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to permit").setRequired(false),
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("Role to permit").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("rename")
      .setDescription("Rename your voice channel")
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("New channel name")
          .setRequired(true)
          .setMaxLength(100),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("bitrate")
      .setDescription("Set voice bitrate")
      .addIntegerOption((opt) =>
        opt
          .setName("kbps")
          .setDescription("Bitrate in kbps (8-384)")
          .setRequired(true)
          .setMinValue(8)
          .setMaxValue(384),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("region")
      .setDescription("Set voice region")
      .addStringOption((opt) =>
        opt
          .setName("region")
          .setDescription("Voice region")
          .setRequired(true)
          .addChoices(
            { name: "Auto", value: "auto" },
            { name: "US West", value: "us-west" },
            { name: "US East", value: "us-east" },
            { name: "US Central", value: "us-central" },
            { name: "US South", value: "us-south" },
            { name: "Singapore", value: "singapore" },
            { name: "Sydney", value: "sydney" },
            { name: "Europe", value: "europe" },
            { name: "Brazil", value: "brazil" },
            { name: "Japan", value: "japan" },
            { name: "India", value: "india" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("claim").setDescription("Claim an abandoned voice channel"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("drag")
      .setDescription("Drag all users from another voice channel into yours")
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("The voice channel to drag users from")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("transfer")
      .setDescription("Transfer VC ownership")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("New owner").setRequired(true),
      ),
  );

const commands = [
  setupCommand.toJSON(),
  updatePanelCommand.toJSON(),
  vcCommand.toJSON(),
];

const rest = new REST().setToken(TOKEN);
const GUILD_IDS = (process.env.GUILD_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

(async () => {
  try {
    console.log(`🔑 Bot CLIENT_ID: ${CLIENT_ID}`);

    if (GUILD_IDS.length > 0) {
      for (const guildId of GUILD_IDS) {
        console.log(
          `🚀 Deploying ${commands.length} commands to guild ${guildId}...`,
        );
        const data = await rest.put(
          Routes.applicationGuildCommands(CLIENT_ID, guildId),
          { body: commands },
        );
        console.log(
          `✅ Deployed ${(data as any[]).length} commands to guild ${guildId}.`,
        );
      }
      console.log("⚡ Guild commands are available immediately!");
    } else {
      console.log(`🚀 Deploying ${commands.length} commands globally...`);
      const data = await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commands,
      });
      console.log(`✅ Deployed ${(data as any[]).length} commands globally.`);
      console.log("⏳ Global commands may take up to 1 hour to propagate.");
    }
  } catch (error) {
    console.error("❌ Failed to deploy commands:", error);
  }
})();
