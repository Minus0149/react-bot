import { Guild, EmbedBuilder, User } from "discord.js";
import { UserLevel } from "../models/UserLevel";
import { rollPeriods } from "./levelingCore";

export type LeaderboardPeriod = "alltime" | "daily" | "weekly" | "monthly";

const FIELD: Record<LeaderboardPeriod, string> = {
  alltime: "xp",
  daily: "dailyXp",
  weekly: "weeklyXp",
  monthly: "monthlyXp",
};

const TITLE: Record<LeaderboardPeriod, string> = {
  alltime: "🏆 All-Time Leaderboard",
  daily: "📅 Daily Leaderboard",
  weekly: "🗓️ Weekly Leaderboard",
  monthly: "📆 Monthly Leaderboard",
};

export interface LeaderboardEntry {
  userId: string;
  xp: number;
  rank: number;
}

export async function getLeaderboard(
  guildId: string,
  period: LeaderboardPeriod,
  limit = 10,
): Promise<LeaderboardEntry[]> {
  // Keep period buckets fresh so the daily/weekly/monthly views reset cleanly.
  await rollPeriods(guildId);

  const sortField = FIELD[period];
  const docs = await UserLevel.find({ guildId, [sortField]: { $gt: 0 } })
    .sort({ [sortField]: -1 })
    .limit(limit)
    .lean();

  return docs.map((d, i) => ({
    userId: d.userId,
    xp: (d as any)[sortField] as number,
    rank: i + 1,
  }));
}

/** Find a single user's rank within a period (1-indexed). 0 if unranked. */
export async function getRank(
  guildId: string,
  userId: string,
  period: LeaderboardPeriod,
): Promise<number> {
  const sortField = FIELD[period];
  const user = await UserLevel.findOne({ guildId, userId }).lean();
  if (!user) return 0;
  const userXp = (user as any)[sortField] as number;
  if (userXp <= 0) return 0;
  const count = await UserLevel.countDocuments({
    guildId,
    [sortField]: { $gt: userXp },
  });
  return count + 1;
}

export async function buildLeaderboardEmbed(
  guild: Guild,
  period: LeaderboardPeriod,
  entries: LeaderboardEntry[],
  clientUser: User,
): Promise<EmbedBuilder> {
  const lines = entries.length
    ? await Promise.all(
        entries.map(async (e) => {
          const medal =
            e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `#${e.rank}`;
          let tag: string;
          try {
            const m = await guild.members.fetch(e.userId);
            tag = m.user.username;
          } catch {
            tag = "Unknown";
          }
          return `${medal} **${tag}** — ${e.xp.toLocaleString()} XP`;
        }),
      )
    : ["No data yet for this period."];

  const embed = new EmbedBuilder()
    .setTitle(TITLE[period])
    .setDescription(lines.join("\n"))
    .setColor(0x5865f2)
    .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })
    .setTimestamp();

  return embed;
}