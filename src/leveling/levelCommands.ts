import {
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  Client,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from "discord.js";
import {
  getUserLevel,
  resolveLevel,
  addXp,
  removeXp,
  setLevel,
  resetUser,
  resetGuild,
  getActiveMultiplier,
} from "./levelingCore";
import { getLevelConfig } from "../models/LevelConfig";
import { LevelReward } from "../models/LevelReward";
import { XpEvent } from "../models/XpEvent";
import {
  getLeaderboard,
  getRank,
  buildLeaderboardEmbed,
  LeaderboardPeriod,
} from "./leaderboard";

// ══════════════════════════════════════════════
// /rank — user-facing rank card
// ══════════════════════════════════════════════

function progressBar(current: number, total: number, width = 12): string {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export async function handleRankCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const guild = interaction.guild!;
  const member = target.id === interaction.user.id
    ? (interaction.member as GuildMember)
    : (await guild.members.fetch(target.id).catch(() => null)) ?? undefined;

  const user = await getUserLevel(guild.id, target.id);
  const prog = resolveLevel(user.xp);
  const rank = await getRank(guild.id, target.id, "alltime");
  const { multiplier, labels } = await getActiveMultiplier(guild.id);

  const pct = prog.xpForNext > 0
    ? Math.floor((prog.xpIntoLevel / prog.xpForNext) * 100)
    : 0;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: target.username,
      iconURL: target.displayAvatarURL(),
    })
    .setTitle(`Rank Card — ${guild.name}`)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      {
        name: "Level",
        value: `**${prog.level}**`,
        inline: true,
      },
      {
        name: "Total XP",
        value: `${prog.totalXp.toLocaleString()}`,
        inline: true,
      },
      {
        name: "Rank",
        value: rank ? `#${rank}` : "Unranked",
        inline: true,
      },
      {
        name: "Progress to next level",
        value:
          `${progressBar(prog.xpIntoLevel, prog.xpForNext)} ${prog.xpIntoLevel}/${prog.xpForNext} (${pct}%)`,
      },
      {
        name: "Messages",
        value: `${user.totalMessages.toLocaleString()}`,
        inline: true,
      },
      {
        name: "Voice minutes",
        value: `${user.totalVoiceMinutes.toLocaleString()}`,
        inline: true,
      },
      {
        name: "Daily streak",
        value: `🔥 ${user.dailyStreak} (best ${user.bestDailyStreak})`,
        inline: true,
      },
    )
    .setFooter({
      text:
        multiplier > 1
          ? `⚡ ${multiplier}x XP active (${labels.join(", ")})`
          : guild.name,
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  void member;
}

// ══════════════════════════════════════════════
// /level — admin command group
// ══════════════════════════════════════════════

function isAdmin(member: GuildMember | null): boolean {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

async function ensureAdmin(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction.member as GuildMember | null)) {
    await interaction.reply({
      content: "❌ You need **Manage Server** permission to use this command.",
      flags: MessageFlags.Ephemeral, // MessageFlags.Ephemeral
    });
    return false;
  }
  return true;
}

async function viewConfig(interaction: ChatInputCommandInteraction) {
  const cfg = await getLevelConfig(interaction.guildId!);
  const embed = new EmbedBuilder()
    .setTitle("⚙️ Leveling Configuration")
    .setColor(0x5865f2)
    .addFields(
      { name: "Message XP", value: `${cfg.messageXpEnabled ? "✅" : "❌"} ${cfg.minXpPerMessage}–${cfg.maxXpPerMessage} XP / msg`, inline: true },
      { name: "Cooldown", value: `${cfg.cooldownSeconds}s`, inline: true },
      { name: "Voice XP", value: `${cfg.voiceXpEnabled ? "✅" : "❌"} ${cfg.voiceXpPerMinute} XP / min`, inline: true },
      { name: "Streak bonus", value: `${cfg.streakEnabled ? "✅" : "❌"} ${cfg.streakBonusXp} XP / streak-day`, inline: true },
      { name: "Level-up", value: `${cfg.levelUpEnabled ? "✅" : "❌"} ${cfg.levelUpDM ? "DM" : "channel"}`, inline: true },
      { name: "Stack rewards", value: cfg.stackRewards ? "✅" : "❌", inline: true },
      { name: "Level-up channel", value: cfg.levelUpChannelId ? `<#${cfg.levelUpChannelId}>` : "Current channel", inline: true },
      { name: "Frozen", value: cfg.locked ? "🔒 Yes" : "🔓 No", inline: true },
      { name: "Ignored channels", value: cfg.ignoredChannels.length ? cfg.ignoredChannels.map((c) => `<#${c}>`).join(", ") : "None", inline: false },
      { name: "Ignored roles", value: cfg.ignoredRoles.length ? cfg.ignoredRoles.map((r) => `<@&${r}>`).join(", ") : "None", inline: false },
      { name: "Level-up message", value: cfg.levelUpMessage, inline: false },
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleConfigGroup(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const cfg = await getLevelConfig(interaction.guildId!);
  const guildId = interaction.guildId!;

  switch (sub) {
    case "view": {
      await viewConfig(interaction);
      return;
    }
    case "messagexp": {
      const min = interaction.options.getInteger("min", true);
      const max = interaction.options.getInteger("max", true);
      cfg.minXpPerMessage = min;
      cfg.maxXpPerMessage = max;
      await cfg.save();
      await interaction.reply({ content: `✅ Message XP set to **${min}–${max}** per message.`, flags: MessageFlags.Ephemeral });
      return;
    }
    case "cooldown": {
      const secs = interaction.options.getInteger("seconds", true);
      cfg.cooldownSeconds = secs;
      await cfg.save();
      await interaction.reply({ content: `✅ Cooldown set to **${secs}s**.`, flags: MessageFlags.Ephemeral });
      return;
    }
    case "voicexp": {
      const per = interaction.options.getInteger("per_minute", true);
      cfg.voiceXpPerMinute = per;
      await cfg.save();
      await interaction.reply({ content: `✅ Voice XP set to **${per} XP / minute**.`, flags: MessageFlags.Ephemeral });
      return;
    }
    case "toggle": {
      const feature = interaction.options.getString("feature", true) as
        | "message" | "voice" | "streak" | "levelup" | "dm" | "stack" | "locked";
      const enabled = interaction.options.getBoolean("enabled", true);
      switch (feature) {
        case "message": cfg.messageXpEnabled = enabled; break;
        case "voice": cfg.voiceXpEnabled = enabled; break;
        case "streak": cfg.streakEnabled = enabled; break;
        case "levelup": cfg.levelUpEnabled = enabled; break;
        case "dm": cfg.levelUpDM = enabled; break;
        case "stack": cfg.stackRewards = enabled; break;
        case "locked": cfg.locked = enabled; break;
      }
      await cfg.save();
      await interaction.reply({ content: `✅ **${feature}** ${enabled ? "enabled" : "disabled"}.`, flags: MessageFlags.Ephemeral });
      return;
    }
    case "levelup_channel": {
      const channel = interaction.options.getChannel("channel");
      const clear = interaction.options.getBoolean("clear");
      if (clear) {
        cfg.levelUpChannelId = "";
        await cfg.save();
        await interaction.reply({ content: "✅ Level-up channel cleared — announcements go to the channel the user leveled up in.", flags: MessageFlags.Ephemeral });
      } else if (channel) {
        cfg.levelUpChannelId = channel.id;
        await cfg.save();
        await interaction.reply({ content: `✅ Level-up channel set to <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: "❌ Provide a channel or set `clear` to true.", flags: MessageFlags.Ephemeral });
      }
      return;
    }
    case "levelup_message": {
      const msg = interaction.options.getString("message", true);
      cfg.levelUpMessage = msg;
      await cfg.save();
      await interaction.reply({ content: `✅ Level-up message updated. Placeholders: \`{user}\` \`{username}\` \`{level}\` \`{guild}\`.`, flags: MessageFlags.Ephemeral });
      return;
    }
    case "ignore_channel": {
      const action = interaction.options.getString("action", true) as "add" | "remove";
      const channel = interaction.options.getChannel("channel", true);
      const set = new Set(cfg.ignoredChannels);
      if (action === "add") set.add(channel.id);
      else set.delete(channel.id);
      cfg.ignoredChannels = [...set];
      await cfg.save();
      await interaction.reply({ content: `✅ ${action === "add" ? "Added" : "Removed"} <#${channel.id}> from ignored channels.`, flags: MessageFlags.Ephemeral });
      return;
    }
    case "ignore_role": {
      const action = interaction.options.getString("action", true) as "add" | "remove";
      const role = interaction.options.getRole("role", true);
      const set = new Set(cfg.ignoredRoles);
      if (action === "add") set.add(role.id);
      else set.delete(role.id);
      cfg.ignoredRoles = [...set];
      await cfg.save();
      await interaction.reply({ content: `✅ ${action === "add" ? "Added" : "Removed"} <@&${role.id}> from ignored roles.`, flags: MessageFlags.Ephemeral });
      return;
    }
    default:
      await interaction.reply({ content: "Unknown config subcommand.", flags: MessageFlags.Ephemeral });
  }
  void guildId;
}

async function handleRewardGroup(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  if (sub === "add") {
    const level = interaction.options.getInteger("level", true);
    const role = interaction.options.getRole("role", true);
    await LevelReward.findOneAndUpdate(
      { guildId, level },
      { $set: { roleId: role.id } },
      { upsert: true },
    );
    await interaction.reply({ content: `✅ Reward set: level **${level}** → <@&${role.id}>.`, flags: MessageFlags.Ephemeral });
  } else if (sub === "remove") {
    const level = interaction.options.getInteger("level", true);
    await LevelReward.deleteOne({ guildId, level });
    await interaction.reply({ content: `✅ Removed reward for level **${level}**.`, flags: MessageFlags.Ephemeral });
  } else if (sub === "list") {
    const rewards = await LevelReward.find({ guildId }).sort({ level: 1 });
    if (!rewards.length) {
      await interaction.reply({ content: "ℹ️ No role rewards configured.", flags: MessageFlags.Ephemeral });
      return;
    }
    const desc = rewards.map((r) => `Level **${r.level}** → <@&${r.roleId}>`).join("\n");
    const embed = new EmbedBuilder().setTitle("🎖️ Level Rewards").setDescription(desc).setColor(0x5865f2);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

async function handleXpGroup(interaction: ChatInputCommandInteraction, client: Client) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser("user", true);
  const guild = interaction.guild!;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "❌ Couldn't find that member.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "add") {
    const amount = interaction.options.getInteger("amount", true);
    const r = await addXp(client, member, amount);
    await interaction.reply({ content: `✅ Added **${amount} XP** to ${user}. Now level **${r.newLevel}**.`, flags: MessageFlags.Ephemeral });
  } else if (sub === "remove") {
    const amount = interaction.options.getInteger("amount", true);
    const r = await removeXp(client, member, amount);
    await interaction.reply({ content: `✅ Removed **${r.xpRemoved} XP** from ${user}. Now level **${r.newLevel}**.`, flags: MessageFlags.Ephemeral });
  } else if (sub === "setlevel") {
    const level = interaction.options.getInteger("level", true);
    const r = await setLevel(client, member, level);
    await interaction.reply({ content: `✅ Set ${user}'s level from **${r.oldLevel}** → **${r.newLevel}**.`, flags: MessageFlags.Ephemeral });
  }
}

async function handleResetGroup(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  if (sub === "user") {
    const user = interaction.options.getUser("user", true);
    await resetUser(guildId, user.id);
    await interaction.reply({ content: `✅ Reset leveling data for ${user}.`, flags: MessageFlags.Ephemeral });
  } else if (sub === "guild") {
    const count = await resetGuild(guildId);
    await interaction.reply({ content: `✅ Reset leveling data for **${count}** users in this server.`, flags: MessageFlags.Ephemeral });
  }
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction, client: Client) {
  const period = interaction.options.getString("period", true) as LeaderboardPeriod;
  await interaction.deferReply();
  const entries = await getLeaderboard(interaction.guildId!, period, 10);
  const embed = await buildLeaderboardEmbed(interaction.guild!, period, entries, client.user!);
  await interaction.editReply({ embeds: [embed] });
}

async function handleMultiplierGroup(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  if (sub === "add") {
    const label = interaction.options.getString("label", true);
    const multiplier = interaction.options.getNumber("multiplier", true);
    const type = interaction.options.getString("type", true) as any;
    const hours = interaction.options.getNumber("hours", true);
    const now = new Date();
    const endsAt = new Date(now.getTime() + hours * 3600000);
    const ev = await XpEvent.create({
      guildId,
      label,
      multiplier,
      type,
      active: true,
      startsAt: now,
      endsAt,
    });
    await interaction.reply({ content: `✅ Multiplier **${multiplier}x** "${label}" active for **${hours}h** (until ${endsAt.toISOString()}).`, flags: MessageFlags.Ephemeral });
    void ev;
  } else if (sub === "list") {
    const events = await XpEvent.find({ guildId, active: true }).sort({ endsAt: 1 });
    if (!events.length) {
      await interaction.reply({ content: "ℹ️ No active XP multipliers.", flags: MessageFlags.Ephemeral });
      return;
    }
    const desc = events.map((e) => `• **${e.multiplier}x** — ${e.label} (${e.type}) until <t:${Math.floor(e.endsAt.getTime() / 1000)}:R>`).join("\n");
    const embed = new EmbedBuilder().setTitle("⚡ Active XP Multipliers").setDescription(desc).setColor(0x5865f2);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else if (sub === "remove") {
    const label = interaction.options.getString("label", true);
    const res = await XpEvent.updateMany(
      { guildId, active: true, label: { $regex: `^${label}$`, $options: "i" } },
      { $set: { active: false } },
    );
    if (res.modifiedCount > 0) {
      await interaction.reply({ content: `✅ Deactivated **${res.modifiedCount}** multiplier(s) matching "${label}".`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: `❌ No active multiplier named "${label}".`, flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleStreak(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const u = await getUserLevel(interaction.guildId!, target.id);
  const embed = new EmbedBuilder()
    .setColor(0xf5770f)
    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
    .setTitle("🔥 Daily Streak")
    .addFields(
      { name: "Current streak", value: `**${u.dailyStreak}** days`, inline: true },
      { name: "Best streak", value: `**${u.bestDailyStreak}** days`, inline: true },
      { name: "Last active", value: u.lastActiveDay || "—", inline: true },
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════
// Router
// ══════════════════════════════════════════════

export async function handleLevelCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  // Group-based dispatch.
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);

  // Top-level subcommands first.
  if (!group) {
    if (sub === "leaderboard") {
      // Leaderboard is public (read-only) — no admin gate.
      await handleLeaderboard(interaction, client);
      return;
    }
    if (sub === "streak") {
      await handleStreak(interaction);
      return;
    }
    await interaction.reply({ content: "❌ Unknown subcommand.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Everything else requires admin.
  if (!(await ensureAdmin(interaction))) return;

  switch (group) {
    case "config":
      await handleConfigGroup(interaction);
      break;
    case "reward":
      await handleRewardGroup(interaction);
      break;
    case "xp":
      await handleXpGroup(interaction, client);
      break;
    case "reset":
      await handleResetGroup(interaction);
      break;
    case "multiplier":
      await handleMultiplierGroup(interaction);
      break;
    default:
      await interaction.reply({ content: "❌ Unknown group.", flags: MessageFlags.Ephemeral });
  }
}