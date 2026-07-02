# ReactBot — Leveling System

A comprehensive, admin-manageable XP & leveling system added to the existing
ReactBot (discord.js v14 + Mongoose + TypeScript). Tracks message and voice
activity, daily/weekly/monthly leaderboards, daily streaks, role rewards,
time-bound XP multiplier events, and full admin control via slash commands.

## Architecture

```
src/
├─ models/
│  ├─ UserLevel.ts      # per-user XP, level, daily/weekly/monthly buckets, streaks, voice time
│  ├─ LevelConfig.ts    # per-guild settings (XP rates, cooldown, channels, ignored lists, locks)
│  ├─ LevelReward.ts    # role granted at a given level
│  └─ XpEvent.ts        # time-bound global XP multiplier events
├─ leveling/
│  ├─ levelingCore.ts   # XP formula, cooldown, streaks, level-up side effects, period resets
│  ├─ voiceTracker.ts   # in-memory voice presence map + periodic voice-XP tick
│  ├─ leaderboard.ts    # all-time / daily / weekly / monthly leaderboard queries + embed
│  └─ levelCommands.ts  # /rank + /level command handlers
├─ index.ts             # wiring: message XP, voice tracking, interaction routing, period scheduler
└─ deploy-commands.ts   # slash command registration (adds /rank + /level)
```

## Level formula

MEE6-style curve. XP needed to advance from level `L` to `L+1`:

```
xpToNext(L) = 5*L² + 50*L + 100
```

So level 0→1 costs 100 XP, 1→2 costs 155, 2→3 costs 220, etc. Total XP to
reach a level is the cumulative sum (`totalXpForLevel`).

## What gets XP

- **Messages**: random XP in `[minXpPerMessage, maxXpPerMessage]`, subject to a
  per-user cooldown (`cooldownSeconds`). Bots, ignored channels, and members
  with an ignored role earn nothing. Configurable via `/level config`.
- **Voice**: `voiceXpPerMinute` granted periodically while a member is in a
  qualifying voice channel (≥2 non-bot members, not the AFK channel, not
  self-muted/deafened). Tracked by an in-memory map polled every 60s.
- **Daily streak**: the first XP-earning message of a new day extends the
  streak and grants a scaling bonus (`streakBonusXp * currentStreak`).

## Period buckets (daily / weekly / monthly)

Each user keeps separate `dailyXp`, `weeklyXp`, `monthlyXp` counters with a
last-reset timestamp. A scheduler (`rollPeriods`) runs every 60s and zeroes
the bucket when its boundary has passed (day rollover / Monday week start /
month rollover). Leaderboards read these buckets, so the daily/weekly/monthly
views reset cleanly while all-time XP is preserved.

XP multiplier events (`XpEvent`) auto-expire at their `endsAt` and are also
pruned by the scheduler.

## Commands

### Public

| Command | Description |
|---|---|
| `/rank [user]` | Rank card: level, total XP, guild rank, progress bar, messages, voice minutes, daily streak, active multiplier. |
| `/level leaderboard <period>` | Top 10 — `alltime` / `daily` / `weekly` / `monthly`. |
| `/level streak [user]` | Daily activity streak (current + best). |

### Admin (requires **Manage Server**)

| Command | Description |
|---|---|
| `/level config view` | Show all settings. |
| `/level config messagexp <min> <max>` | XP per message range. |
| `/level config cooldown <seconds>` | Message XP cooldown. |
| `/level config voicexp <per_minute>` | Voice XP rate. |
| `/level config toggle <feature> <enabled>` | Toggle: `message` `voice` `streak` `levelup` `dm` `stack` `locked`. |
| `/level config levelup_channel <channel|clear>` | Channel for level-up announcements. |
| `/level config levelup_message <text>` | Message template (`{user}` `{username}` `{level}` `{guild}`). |
| `/level config ignore_channel <add\|remove> <channel>` | No-XP channels. |
| `/level config ignore_role <add\|remove> <role>` | No-XP roles. |
| `/level reward add <level> <role>` | Grant a role at a level. |
| `/level reward remove <level>` | Remove a level reward. |
| `/level reward list` | List all rewards. |
| `/level xp add <user> <amount>` | Grant XP. |
| `/level xp remove <user> <amount>` | Remove XP (demotes rewards). |
| `/level xp setlevel <user> <level>` | Set a user's level directly. |
| `/level reset user <user>` | Reset one user. |
| `/level reset guild` | Reset the whole server. |
| `/level multiplier add <label> <multiplier> <type> <hours>` | Start a timed XP event (e.g. 2x weekend). `type`: daily/weekly/monthly/custom. |
| `/level multiplier list` | List active multipliers. |
| `/level multiplier remove <label>` | Deactivate a multiplier by label. |

## Role rewards

When a user levels up, the reward logic grants the configured role(s). With
`stack` enabled, every reward at or below the current level is kept; with
`stack` off, only the highest attained reward role is kept and lower ones are
removed. Demotion (via `xp remove` / `xp setlevel`) strips rewards above the
new level.

## Setup

1. `bun install`
2. Copy `.env` with `DISCORD_TOKEN`, `MONGODB_URI`, `GUILD_ID` (comma-separated for guild-scoped deploy).
3. `bun run build` (compile TS → `dist/`)
4. `bun run deploy` (register slash commands)
5. `bun run start`

No extra dependencies were added — the leveling system uses the existing
`discord.js` + `mongoose` stack already in `package.json`.