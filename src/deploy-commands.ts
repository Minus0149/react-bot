import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import dotenv from "dotenv";

// Note: keep command builders in sync with handlers in src/leveling/levelCommands.ts

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

// ──────────────────────────────────────────────
// LEVELING SYSTEM — /rank + /level
// ──────────────────────────────────────────────

// /rank — public rank card
const rankCommand = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("View your (or someone's) XP rank card")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Whose rank to view").setRequired(false),
  );

// /level — admin command group
// Note: the sensitive subcommand groups (config/reward/xp/reset/multiplier) are
// admin-gated inside the handler. We intentionally do NOT set default member
// permissions here so the public `leaderboard` and `streak` subcommands remain
// usable by everyone. `/rank` is the primary public entry point.
const levelCommand = new SlashCommandBuilder()
  .setName("level")
  .setDescription("Leveling system — rankings, leaderboards, streaks & admin tools")

  // ── config group ──
  .addSubcommandGroup((group) =>
    group
      .setName("config")
      .setDescription("View and edit leveling configuration")
      .addSubcommand((s) => s.setName("view").setDescription("Show current configuration"))
      .addSubcommand((s) =>
        s
          .setName("messagexp")
          .setDescription("Set XP earned per message")
          .addIntegerOption((o) => o.setName("min").setDescription("Min XP per message").setRequired(true).setMinValue(0).setMaxValue(1000))
          .addIntegerOption((o) => o.setName("max").setDescription("Max XP per message").setRequired(true).setMinValue(0).setMaxValue(1000)),
      )
      .addSubcommand((s) =>
        s
          .setName("cooldown")
          .setDescription("Set the message XP cooldown")
          .addIntegerOption((o) => o.setName("seconds").setDescription("Cooldown in seconds").setRequired(true).setMinValue(0).setMaxValue(3600)),
      )
      .addSubcommand((s) =>
        s
          .setName("voicexp")
          .setDescription("Set XP earned per minute in voice")
          .addIntegerOption((o) => o.setName("per_minute").setDescription("XP per minute in voice").setRequired(true).setMinValue(0).setMaxValue(1000)),
      )
      .addSubcommand((s) =>
        s
          .setName("toggle")
          .setDescription("Enable/disable a leveling feature")
          .addStringOption((o) =>
            o
              .setName("feature")
              .setDescription("Feature to toggle")
              .setRequired(true)
              .addChoices(
                { name: "Message XP", value: "message" },
                { name: "Voice XP", value: "voice" },
                { name: "Daily streak", value: "streak" },
                { name: "Level-up announcements", value: "levelup" },
                { name: "Level-up DM", value: "dm" },
                { name: "Stack role rewards", value: "stack" },
                { name: "Freeze all XP (lock)", value: "locked" },
              ),
          )
          .addBooleanOption((o) => o.setName("enabled").setDescription("Enable or disable").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("levelup_channel")
          .setDescription("Set the channel for level-up messages")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Channel for announcements").addChannelTypes(ChannelType.GuildText).setRequired(false),
          )
          .addBooleanOption((o) => o.setName("clear").setDescription("Clear and use the channel the user leveled up in").setRequired(false)),
      )
      .addSubcommand((s) =>
        s
          .setName("levelup_message")
          .setDescription("Set the level-up message. Placeholders: {user} {username} {level} {guild}")
          .addStringOption((o) => o.setName("message").setDescription("Message template").setRequired(true).setMaxLength(500)),
      )
      .addSubcommand((s) =>
        s
          .setName("ignore_channel")
          .setDescription("Add/remove a channel from the no-XP list")
          .addStringOption((o) => o.setName("action").setDescription("Add or remove").setRequired(true).addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }))
          .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("ignore_role")
          .setDescription("Add/remove a role from the no-XP list")
          .addStringOption((o) => o.setName("action").setDescription("Add or remove").setRequired(true).addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }))
          .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
      ),
  )

  // ── reward group ──
  .addSubcommandGroup((group) =>
    group
      .setName("reward")
      .setDescription("Manage role rewards for reaching levels")
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Grant a role at a given level")
          .addIntegerOption((o) => o.setName("level").setDescription("Level threshold").setRequired(true).setMinValue(1).setMaxValue(500))
          .addRoleOption((o) => o.setName("role").setDescription("Role to grant").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove a level reward")
          .addIntegerOption((o) => o.setName("level").setDescription("Level threshold").setRequired(true).setMinValue(1).setMaxValue(500)),
      )
      .addSubcommand((s) => s.setName("list").setDescription("List all level rewards")),
  )

  // ── xp group ──
  .addSubcommandGroup((group) =>
    group
      .setName("xp")
      .setDescription("Manually adjust a user's XP/level")
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Add XP to a user")
          .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("XP to add").setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove XP from a user")
          .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("XP to remove").setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName("setlevel")
          .setDescription("Set a user's level directly")
          .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
          .addIntegerOption((o) => o.setName("level").setDescription("New level").setRequired(true).setMinValue(0).setMaxValue(500)),
      ),
  )

  // ── reset group ──
  .addSubcommandGroup((group) =>
    group
      .setName("reset")
      .setDescription("Reset leveling data")
      .addSubcommand((s) =>
        s
          .setName("user")
          .setDescription("Reset a single user's leveling data")
          .addUserOption((o) => o.setName("user").setDescription("User to reset").setRequired(true)),
      )
      .addSubcommand((s) => s.setName("guild").setDescription("Reset ALL leveling data for this server")),
  )

  // ── multiplier group ──
  .addSubcommandGroup((group) =>
    group
      .setName("multiplier")
      .setDescription("Manage global XP multiplier events")
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Start a temporary XP multiplier event")
          .addStringOption((o) => o.setName("label").setDescription("Event name").setRequired(true).setMaxLength(50))
          .addNumberOption((o) => o.setName("multiplier").setDescription("Multiplier (e.g. 2 = 2x)").setRequired(true).setMinValue(0.1).setMaxValue(100))
          .addStringOption((o) =>
            o
              .setName("type")
              .setDescription("Event cadence label")
              .setRequired(true)
              .addChoices(
                { name: "Daily", value: "daily" },
                { name: "Weekly", value: "weekly" },
                { name: "Monthly", value: "monthly" },
                { name: "Custom", value: "custom" },
              ),
          )
          .addNumberOption((o) => o.setName("hours").setDescription("Duration in hours").setRequired(true).setMinValue(0.01).setMaxValue(24 * 365)),
      )
      .addSubcommand((s) => s.setName("list").setDescription("List active XP multipliers"))
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Deactivate an XP multiplier by label")
          .addStringOption((o) => o.setName("label").setDescription("Exact label to deactivate").setRequired(true)),
      ),
  )

  // ── public top-level subcommands ──
  .addSubcommand((s) =>
    s
      .setName("leaderboard")
      .setDescription("Show the leaderboard")
      .addStringOption((o) =>
        o
          .setName("period")
          .setDescription("Leaderboard period")
          .setRequired(true)
          .addChoices(
            { name: "All-time", value: "alltime" },
            { name: "Daily", value: "daily" },
            { name: "Weekly", value: "weekly" },
            { name: "Monthly", value: "monthly" },
          ),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("streak")
      .setDescription("View daily activity streak")
      .addUserOption((o) => o.setName("user").setDescription("Whose streak to view").setRequired(false)),
  );

const commands = [
  setupCommand.toJSON(),
  updatePanelCommand.toJSON(),
  vcCommand.toJSON(),
  rankCommand.toJSON(),
  levelCommand.toJSON(),
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
