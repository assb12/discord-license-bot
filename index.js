require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');

// Inisialisasi Express untuk Webhook & API
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Inisialisasi Discord Bot Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

let db;

// Fungsi Inisialisasi Sistem Database & Server
async function initSystem() {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    // Tabel Lisensi yang Diperbarui dengan Status & Discord ID
    await db.exec(`
        CREATE TABLE IF NOT EXISTS licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_key TEXT UNIQUE,
            buyer_discord_id TEXT,
            product_name TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('📦 Database SQLite siap.');

    // --- 1. WEBHOOK PEMBAYARAN (Dengan Proteksi API Key) ---
app.post('/webhook/payment', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    // Ganti string rahasia di bawah dengan password/token rahasia lu sendiri
    if (apiKey !== process.env.SECRET_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: API Key salah atau tidak ada!' });
    }

    const { discord_id, product_name } = req.body;
    if (!discord_id) {
        return res.status(400).json({ error: 'Discord ID wajib disertakan!' });
    }

    try {
        const newKey = `LICENSE-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        
        await db.run(
            `INSERT INTO licenses (license_key, buyer_discord_id, product_name) VALUES (?, ?, ?)`,
            [newKey, discord_id, product_name || 'Digital Product']
        );

        try {
            const user = await client.users.fetch(discord_id);
            await user.send(`🎉 **Terima kasih atas pembelian produk ${product_name || 'digital'} lu!**\nBerikut adalah license key unik lu:\n\`\`\`${newKey}\`\`\`\nSimpan key ini baik-baik!`);
        } catch (dmError) {
            console.log(`⚠️ Gagal mengirim DM ke user ${discord_id}. Key: ${newKey}`);
        }

        return res.status(200).json({ success: true, license_key: newKey });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Gagal memproses webhook pembayaran.' });
    }
});

// --- 2. API VERIFIKASI LISENSI (Dengan Proteksi API Key) ---
app.post('/api/verify-license', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.SECRET_API_KEY) {
        return res.status(401).json({ valid: false, message: 'Unauthorized: API Key tidak valid!' });
    }

    const { license_key } = req.body;
    if (!license_key) {
        return res.status(400).json({ valid: false, message: 'License key tidak boleh kosong.' });
    }

    const license = await db.get(`SELECT * FROM licenses WHERE license_key = ?`, [license_key]);

    if (!license) {
        return res.json({ valid: false, message: 'License key tidak ditemukan di database.' });
    }

    if (license.status !== 'active') {
        return res.json({ valid: false, message: 'License key sudah tidak aktif / diblokir.' });
    }

    return res.json({ 
        valid: true, 
        message: 'Lisensi valid!', 
        product: license.product_name,
        discord_id: license.buyer_discord_id 
    });
});
    // Jalankan Server Express
    app.listen(PORT, () => {
        console.log(`🚀 Webhook & API server berjalan di port ${PORT}`);
    });

    // Login Bot Discord
    client.login(process.env.DISCORD_BOT_TOKEN);
}

// Event Ready Bot & Auto Register Slash Command
client.once('ready', async () => {
    console.log(`✅ Bot Discord logged in sebagai ${client.user.tag}!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('claim')
            .setDescription('Klaim license key produk digital lu secara manual')
            .addStringOption(option =>
                option.setName('order_id')
                    .setDescription('Masukkan ID Transaksi pembelian lu')
                    .setRequired(true))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    try {
        console.log('🔄 Mendaftarkan slash commands (/) ...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('✨ Slash commands berhasil didaftarkan!');
    } catch (error) {
        console.error(error);
    }
});

// Event Handler untuk Command `/claim`
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'claim') {
        const discordId = interaction.user.id;

        let existing = await db.get(`SELECT * FROM licenses WHERE buyer_discord_id = ?`, [discordId]);
        if (existing) {
            return interaction.reply({ 
                content: `❌ Lu sudah memiliki lisensi terdaftar! Key lu: \`${existing.license_key}\``, 
                ephemeral: true 
            });
        }

        const newKey = `LICENSE-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        
        await db.run(
            `INSERT INTO licenses (license_key, buyer_discord_id, product_name) VALUES (?, ?, ?)`,
            [newKey, discordId, 'Marketplace Product']
        );

        return interaction.reply({ 
            content: `🎉 **Klaim Berhasil!** Lisensi produk lu:\n\`\`\`${newKey}\`\`\`\nJangan bagikan key ini ke siapapun!`, 
            ephemeral: true 
        });
    }
});

initSystem().catch(console.error);