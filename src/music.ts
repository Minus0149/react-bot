import {
  Client,
  Message,
  EmbedBuilder,
  PermissionsBitField,
  GuildMember,
} from "discord.js";
import { Player, GuildQueueEvent, QueueRepeatMode } from "discord-player";
import { DefaultExtractors } from "@discord-player/extractor";
import { YoutubeiExtractor } from "discord-player-youtubei";

// ──────────────────────────────────────────────
// 🎵  MUSIC SYSTEM — discord-player integration
// ──────────────────────────────────────────────

// Module-level player reference (hooks don't work with prefix commands)
let player: Player;

const MUSIC_COMMANDS = [
  "play",
  "p",
  "skip",
  "s",
  "stop",
  "dc",
  "disconnect",
  "pause",
  "resume",
  "queue",
  "q",
  "nowplaying",
  "np",
  "volume",
  "vol",
  "shuffle",
  "loop",
];

/**
 * Initialize the music player.
 * Call once AFTER client is ready.
 */
export async function initMusic(client: Client): Promise<void> {
  player = new Player(client);

  // Load default extractors (Spotify, SoundCloud, Apple Music, attachments, etc.)
  await player.extractors.loadMulti(DefaultExtractors);

  // Unregister the broken default YouTube extractor
  await player.extractors.unregister("com.discord-player.youtubeextractor");

  // Register YoutubeiExtractor — uses YouTube's Innertube API, much more reliable
  await player.extractors.register(YoutubeiExtractor, {});

  // ── Lifecycle Events ──────────────────────────

  player.events.on(GuildQueueEvent.PlayerStart, async (queue, track) => {
    const channel = queue.metadata as any;
    if (!channel?.send) return;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎶  Now Playing")
      .setDescription(`[**${track.title}**](${track.url})`)
      .addFields(
        { name: "Artist", value: track.author || "Unknown", inline: true },
        { name: "Duration", value: track.duration || "Live", inline: true },
        {
          name: "Requested by",
          value: track.requestedBy?.tag || "Unknown",
          inline: true,
        },
      )
      .setThumbnail(track.thumbnail || null)
      .setTimestamp();

    channel.send({ embeds: [embed] }).catch(() => null);
  });

  player.events.on(GuildQueueEvent.PlayerFinish, async (_queue, _track) => {
    // Next track auto-plays if queue isn't empty
  });

  player.events.on(GuildQueueEvent.EmptyQueue, async (queue) => {
    const channel = queue.metadata as any;
    if (!channel?.send) return;
    channel
      .send("✅ Queue finished. Leaving the voice channel.")
      .catch(() => null);
  });

  player.events.on(GuildQueueEvent.PlayerError, async (queue, error) => {
    console.error(`[Music] Player error: ${error.message}`);
    const channel = queue.metadata as any;
    if (channel?.send) {
      channel.send(`❌ Player error: ${error.message}`).catch(() => null);
    }
  });

  player.events.on(GuildQueueEvent.Error, async (_queue, error) => {
    console.error(`[Music] General error: ${error.message}`);
  });

  player.events.on(GuildQueueEvent.PlayerSkip, async (queue, track) => {
    console.error(`[Music] Skipped unplayable track: ${track.title}`);
    const channel = queue.metadata as any;
    if (channel?.send) {
      channel
        .send(`⚠️ Couldn't stream **${track.title}** — skipping.`)
        .catch(() => null);
    }
  });

  console.log("🎵 Music system initialized — extractors loaded.");
}

/**
 * Check if a command name is a music command.
 */
export function isMusicCommand(commandName: string): boolean {
  return MUSIC_COMMANDS.includes(commandName);
}

/**
 * Route and handle a music prefix command.
 */
export async function handleMusicCommand(
  message: Message,
  args: string[],
  commandName: string,
): Promise<void> {
  switch (commandName) {
    case "play":
    case "p":
      return cmdPlay(message, args);

    case "skip":
    case "s":
      return cmdSkip(message);

    case "stop":
    case "dc":
    case "disconnect":
      return cmdStop(message);

    case "pause":
      return cmdPause(message);

    case "resume":
      return cmdResume(message);

    case "queue":
    case "q":
      return cmdQueue(message);

    case "nowplaying":
    case "np":
      return cmdNowPlaying(message);

    case "volume":
    case "vol":
      return cmdVolume(message, args);

    case "shuffle":
      return cmdShuffle(message);

    case "loop":
      return cmdLoop(message, args);

    default:
      break;
  }
}

// ══════════════════════════════════════════════
// HELPER — get queue for a guild via player.nodes
// ══════════════════════════════════════════════

function getQueue(guildId: string) {
  return player.nodes.get(guildId);
}

// ══════════════════════════════════════════════
// COMMAND IMPLEMENTATIONS
// ══════════════════════════════════════════════

async function cmdPlay(message: Message, args: string[]): Promise<void> {
  const query = args.join(" ");
  if (!query) {
    await message.reply("❌ Usage: `!play <song name or URL>`");
    return;
  }

  const member = message.member as GuildMember;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await message.reply("❌ You need to be in a voice channel to play music.");
    return;
  }

  // Permission checks
  const me = message.guild?.members.me;
  if (
    me &&
    !voiceChannel.permissionsFor(me).has(PermissionsBitField.Flags.Connect)
  ) {
    await message.reply(
      "❌ I don't have permission to join your voice channel.",
    );
    return;
  }
  if (
    me &&
    !voiceChannel.permissionsFor(me).has(PermissionsBitField.Flags.Speak)
  ) {
    await message.reply(
      "❌ I don't have permission to speak in your voice channel.",
    );
    return;
  }

  // Check if bot is already in a DIFFERENT voice channel
  if (me?.voice?.channel && me.voice.channel.id !== voiceChannel.id) {
    await message.reply("❌ I'm already playing in a different voice channel.");
    return;
  }

  const searching = await message.reply(`🔍 Searching for **${query}**...`);

  try {
    const result = await player.play(voiceChannel, query, {
      nodeOptions: {
        metadata: message.channel, // store text channel for event messages
      },
      requestedBy: message.author,
    });

    await searching.edit(
      `✅ **${result.track.title}** by *${result.track.author}* — added to the queue.`,
    );
  } catch (error: any) {
    console.error("[Music] Play error:", error);
    await searching
      .edit(`❌ Could not play: ${error.message}`)
      .catch(() => null);
  }
}

async function cmdSkip(message: Message): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue || !queue.isPlaying()) {
    await message.reply("❌ Nothing is playing right now.");
    return;
  }

  const current = queue.currentTrack;
  queue.node.skip();
  await message.reply(`⏭️ Skipped **${current?.title || "current track"}**.`);
}

async function cmdStop(message: Message): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue) {
    await message.reply("❌ Nothing is playing right now.");
    return;
  }

  queue.delete();
  await message.reply("⏹️ Stopped playback and cleared the queue.");
}

async function cmdPause(message: Message): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue || !queue.isPlaying()) {
    await message.reply("❌ Nothing is playing right now.");
    return;
  }

  if (queue.node.isPaused()) {
    await message.reply("⚠️ Already paused. Use `!resume` to continue.");
    return;
  }

  queue.node.setPaused(true);
  await message.reply("⏸️ Paused the music.");
}

async function cmdResume(message: Message): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue) {
    await message.reply("❌ Nothing is playing right now.");
    return;
  }

  if (!queue.node.isPaused()) {
    await message.reply("⚠️ Music is already playing.");
    return;
  }

  queue.node.setPaused(false);
  await message.reply("▶️ Resumed the music.");
}

async function cmdQueue(message: Message): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue || (!queue.currentTrack && queue.tracks.size === 0)) {
    await message.reply("❌ The queue is empty.");
    return;
  }

  const current = queue.currentTrack;
  const tracks = queue.tracks.toArray().slice(0, 10);

  const description = [
    current
      ? `**Now Playing:** [${current.title}](${current.url}) — \`${current.duration}\``
      : "",
    "",
    tracks.length > 0 ? "**Up Next:**" : "",
    ...tracks.map(
      (track, i) =>
        `\`${i + 1}.\` [${track.title}](${track.url}) — \`${track.duration}\``,
    ),
    "",
    queue.tracks.size > 10
      ? `...and **${queue.tracks.size - 10}** more tracks.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋  Queue — ${queue.tracks.size + (current ? 1 : 0)} tracks`)
    .setDescription(description || "Nothing here.")
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

async function cmdNowPlaying(message: Message): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue || !queue.currentTrack) {
    await message.reply("❌ Nothing is playing right now.");
    return;
  }

  const track = queue.currentTrack;
  const progress = queue.node.createProgressBar() || "▬▬▬▬▬▬▬▬▬▬▬▬";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎵  Now Playing")
    .setDescription(`[**${track.title}**](${track.url})\nby *${track.author}*`)
    .addFields({ name: "Progress", value: progress })
    .setThumbnail(track.thumbnail || null)
    .setFooter({ text: `Requested by ${track.requestedBy?.tag || "Unknown"}` })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

async function cmdVolume(message: Message, args: string[]): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue || !queue.isPlaying()) {
    await message.reply("❌ Nothing is playing right now.");
    return;
  }

  if (args.length === 0) {
    await message.reply(`🔊 Current volume: **${queue.node.volume}%**`);
    return;
  }

  const vol = parseInt(args[0], 10);

  if (isNaN(vol) || vol < 0 || vol > 200) {
    await message.reply(
      "❌ Volume must be a number between **0** and **200**.",
    );
    return;
  }

  queue.node.setVolume(vol);
  await message.reply(`🔊 Volume set to **${vol}%**.`);
}

async function cmdShuffle(message: Message): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue || queue.tracks.size < 2) {
    await message.reply("❌ Not enough tracks in the queue to shuffle.");
    return;
  }

  queue.tracks.shuffle();
  await message.reply(`🔀 Shuffled **${queue.tracks.size}** tracks.`);
}

async function cmdLoop(message: Message, args: string[]): Promise<void> {
  const queue = getQueue(message.guild!.id);

  if (!queue) {
    await message.reply("❌ Nothing is playing right now.");
    return;
  }

  const modeMap: Record<string, QueueRepeatMode> = {
    off: QueueRepeatMode.OFF,
    track: QueueRepeatMode.TRACK,
    queue: QueueRepeatMode.QUEUE,
    autoplay: QueueRepeatMode.AUTOPLAY,
  };

  const modeLabels: Record<number, string> = {
    [QueueRepeatMode.OFF]: "🚫 Off",
    [QueueRepeatMode.TRACK]: "🔂 Track",
    [QueueRepeatMode.QUEUE]: "🔁 Queue",
    [QueueRepeatMode.AUTOPLAY]: "♾️ Autoplay",
  };

  if (args.length === 0) {
    const current = queue.repeatMode;
    await message.reply(
      `🔁 Current loop mode: **${modeLabels[current] || "Off"}**\n` +
        `Usage: \`!loop <off|track|queue|autoplay>\``,
    );
    return;
  }

  const input = args[0].toLowerCase();
  const mode = modeMap[input];

  if (mode === undefined) {
    await message.reply(
      "❌ Invalid mode. Use: `off`, `track`, `queue`, or `autoplay`.",
    );
    return;
  }

  queue.setRepeatMode(mode);
  await message.reply(`${modeLabels[mode]} Loop mode set to **${input}**.`);
}
