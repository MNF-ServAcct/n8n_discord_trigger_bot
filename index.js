require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const axios = require('axios');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config persistence (simple JSON file — no database needed)
// ---------------------------------------------------------------------------
const CONFIG_FILE = path.join(__dirname, 'webhooks.json');

const loadWebhooks = () => {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('Failed to load webhooks.json:', err.message);
    }
    return {};
};

const saveWebhooks = (map) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(map, null, 2));
};

// channelId → webhookUrl
let webhooks = loadWebhooks();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const isValidWebhookUrl = (raw) => {
    let url;
    try { url = new URL(raw); } catch { return false; }

    if (url.protocol !== 'https:') return false;

    // Block private / loopback / link-local ranges (SSRF protection)
    const h = url.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;

    return true;
};

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ---------------------------------------------------------------------------
// Message forwarding
// ---------------------------------------------------------------------------
client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    const webhookUrl = webhooks[msg.channelId];
    if (!webhookUrl) return;

    try {
        await axios.post(webhookUrl, {
            event:     'message_create',
            messageId: msg.id,
            content:   msg.content,
            author: {
                id:          msg.author.id,
                username:    msg.author.username,
                displayName: msg.member?.displayName ?? msg.author.username,
            },
            channel: {
                id:   msg.channelId,
                name: msg.channel.name,
            },
            guild: {
                id:   msg.guildId,
                name: msg.guild?.name,
            },
            attachments: msg.attachments.map((a) => ({ name: a.name, url: a.url })),
            timestamp:   msg.createdAt.toISOString(),
        }, { timeout: 10000 });
    } catch (err) {
        console.error(`[webhook] channel ${msg.channelId} failed: ${err.message}`);
    }
});

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // --- /setup ---
    if (commandName === 'setup') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({
                content: '❌ You need the **Manage Channels** permission to use this command.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const webhookUrl = interaction.options.getString('webhook_url', true);

        if (!isValidWebhookUrl(webhookUrl)) {
            return interaction.reply({
                content: '❌ Invalid URL. Must be a public HTTPS address.',
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await axios.post(webhookUrl, { event: 'test' }, { timeout: 10000 });
        } catch (err) {
            return interaction.editReply(`❌ Could not reach the webhook: \`${err.message}\``);
        }

        webhooks[interaction.channelId] = webhookUrl;
        saveWebhooks(webhooks);

        return interaction.editReply(
            `✅ Webhook configured for <#${interaction.channelId}>. New messages will be forwarded.`
        );
    }

    // --- /remove ---
    if (commandName === 'remove') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({
                content: '❌ You need the **Manage Channels** permission to use this command.',
                flags: MessageFlags.Ephemeral,
            });
        }

        if (!webhooks[interaction.channelId]) {
            return interaction.reply({
                content: 'ℹ️ No webhook is configured for this channel.',
                flags: MessageFlags.Ephemeral,
            });
        }

        delete webhooks[interaction.channelId];
        saveWebhooks(webhooks);

        return interaction.reply({
            content: `✅ Webhook removed from <#${interaction.channelId}>.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- /status ---
    if (commandName === 'status') {
        const webhookUrl = webhooks[interaction.channelId];
        if (!webhookUrl) {
            return interaction.reply({
                content: 'ℹ️ No webhook configured for this channel.',
                flags: MessageFlags.Ephemeral,
            });
        }
        const host = new URL(webhookUrl).hostname;
        return interaction.reply({
            content: `✅ Webhook active for this channel → \`${host}/…\``,
            flags: MessageFlags.Ephemeral,
        });
    }
});

// ---------------------------------------------------------------------------
// Register slash commands on startup
// ---------------------------------------------------------------------------
const registerCommands = async () => {
    const commands = [
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Forward new messages in this channel to an n8n webhook')
            .addStringOption((opt) =>
                opt.setName('webhook_url')
                    .setDescription('Your n8n webhook URL (must be HTTPS)')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

        new SlashCommandBuilder()
            .setName('remove')
            .setDescription('Stop forwarding messages from this channel')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Check whether this channel has a webhook configured'),
    ].map((cmd) => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log('Slash commands registered.');
};

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const requiredEnv = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
const missing = requiredEnv.filter((v) => !process.env[v]);
if (missing.length) {
    console.error('Missing required env vars:', missing.join(', '));
    process.exit(1);
}

client.once('ready', async () => {
    console.log(`Bot ready: ${client.user.tag}`);
    await registerCommands();
});

client.login(process.env.DISCORD_TOKEN);
