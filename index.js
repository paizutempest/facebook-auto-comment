import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { GoogleGenAI } from '@google/genai';
import TelegramBot from 'node-telegram-bot-api';
import chalk from "chalk";
import dayjs from "dayjs";
import fs from "fs";
import path from "path";

chromium.use(stealth());


const CONFIG = {
    GEMINI_API_KEY: "TARUH_API_KEY_GEMINI_LO_DI_SINI",
    TELEGRAM_TOKEN: "TARUH_TOKEN_BOT_TELEGRAM_LO_DI_SINI",
    OWNER_CHAT_ID: "TARUH_CHAT_ID_TELEGRAM_LO_DI_SINI", 
    DEFAULT_ACCOUNT: "akun_tumbal_1"
};

const DB_FILE = path.join(process.cwd(), "database.json");
const SESSION_FILE = path.join(process.cwd(), `session_${CONFIG.DEFAULT_ACCOUNT}.json`);

// Inisialisasi API & Telegram
const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_API_KEY });
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });

// Logger Visual di Terminal
const log = {
    info: (msg) => console.log(`${chalk.cyan('ℹ')} [${dayjs().format('HH:mm:ss')}] ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} [${dayjs().format('HH:mm:ss')}] ${msg}`),
    warn: (msg) => console.log(`${chalk.yellow('⚠')} [${dayjs().format('HH:mm:ss')}] ${msg}`),
    error: (msg) => console.log(`${chalk.red('✖')} [${dayjs().format('HH:mm:ss')}] ${msg}`)
};

// =========================================================================
// LOCAL DATABASE HANDLER (Simpan Link & Keyword)
// =========================================================================
function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ targets: [] }, null, 2));
    }
}
function getDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

initDB();

// Middleware Keamanan (Biar grup/orang lain gak bisa acak-acak bot lo)
function isOwner(msg) {
    return msg.chat.id.toString() === CONFIG.OWNER_CHAT_ID.toString();
}

// =========================================================================
// TELEGRAM BOT ROUTER (COMMAND HANDLER)
// =========================================================================

// 1. Command /add <link> <keyword>
bot.onText(/\/add (.+) (.+)/, async (msg, match) => {
    if (!isOwner(msg)) return;
    const chatId = msg.chat.id;
    const linkShopee = match[1].trim();
    const keywordTarget = match[2].trim();

    if (!linkShopee.includes("shope.ee") && !linkShopee.includes("shopee.co.id")) {
        return bot.sendMessage(chatId, "❌ *Format Link Salah!* Pastikan memasukkan link Shopee yang valid.", { parse_mode: "Markdown" });
    }

    const db = getDB();
    db.targets.push({
        id: Date.now(),
        link: linkShopee,
        keyword: keywordTarget,
        createdAt: dayjs().format('YYYY-MM-DD HH:mm')
    });
    saveDB(db);

    log.success(`Target Berhasil Ditambahkan: [${keywordTarget}] -> [${linkShopee}]`);
    bot.sendMessage(chatId, `✅ *Target Sniper Berhasil Ditambahkan!*\n\n🔍 *Keyword:* \`${keywordTarget}\`\n🔗 *Link:* ${linkShopee}`, { parse_mode: "Markdown" });
});

// 2. Command /list
bot.onText(/\/list/, async (msg) => {
    if (!isOwner(msg)) return;
    const db = getDB();
    if (db.targets.length === 0) {
        return bot.sendMessage(msg.chat.id, "📭 *Database Kosong!* Belum ada keyword target yang dimasukkan.", { parse_mode: "Markdown" });
    }

    let teks = "🎯 *Daftar Target Aktif Sniper:*\n\n";
    db.targets.forEach((t, index) => {
        teks += `${index + 1}. 🔍 \`${t.keyword}\`\n🔗 Link: ${t.link}\n\n`;
    });

    bot.sendMessage(msg.chat.id, teks, { parse_mode: "Markdown", disable_web_page_preview: true });
});

// 3. Command /deleteall
bot.onText(/\/deleteall/, async (msg) => {
    if (!isOwner(msg)) return;
    saveDB({ targets: [] });
    log.warn("Database dibersihkan via perintah Telegram.");
    bot.sendMessage(msg.chat.id, "🗑️ *Semua target keyword dan link berhasil dihapus!*", { parse_mode: "Markdown" });
});

// 4. Command /run (Untuk Trigger Manual Proses Sniper FB)
bot.onText(/\/run/, async (msg) => {
    if (!isOwner(msg)) return;
    bot.sendMessage(msg.chat.id, "🚀 *Engine Sniper Dimulai!* Membuka FB Browser Context...", { parse_mode: "Markdown" });
    executeSniperEngine();
});


// =========================================================================
// CORE ENGINE: FACEBOOK AFFILIATE SNIPER (PLAYWRIGHT + GEMINI)
// =========================================================================
async function executeSniperEngine() {
    const db = getDB();
    if (db.targets.length === 0) {
        return bot.sendMessage(CONFIG.OWNER_CHAT_ID, "⚠️ *Gagal Run:* Database target kosong. Tambah target dulu dengan `/add`.");
    }

    log.info("Memulai Engine Sniper Facebook...");
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    let context;
    if (fs.existsSync(SESSION_FILE)) {
        log.info("Mengabaikan Form Login, Menggunakan Cookies Session Lama...");
        context = await browser.newContext({ storageState: SESSION_FILE });
    } else {
        log.warn("Session JSON tidak ditemukan. Pembuatan Session Baru Dimulai.");
        context = await browser.newContext();
    }

    const page = await context.newPage();

    try {
        // Cek Login validasi ke FB
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        const isNeedLogin = await page.locator('input[name="email"]').isVisible().catch(() => false);

        if (isNeedLogin) {
            log.warn("Deteksi Checkpoint/Logout! Butuh Intervensi Manual.");
            await bot.sendMessage(CONFIG.OWNER_CHAT_ID, "⚠️ *Akun Ter-logout!* Silakan login manual langsung di browser PC lo sekarang (Waktu 60s).");
            
            await page.waitForURL('**/facebook.com/**', { timeout: 60000 });
            const storage = await context.storageState();
            fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));
            
            await bot.sendMessage(CONFIG.OWNER_CHAT_ID, "✅ *Session Baru Tersimpan!* Silakan ketik `/run` kembali.");
            await browser.close();
            return;
        }

        // LOOPING SCANNING BERDASARKAN TARGET DI DATABASE JSON
        for (const target of db.targets) {
            log.info(`Target Aktif -> Menggunakan Keyword: [${target.keyword}]`);
            
            // Masuk pencarian global filter Postingan Terbaru
            const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(target.keyword)}&filters=eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJndXNcIjpcIlwifSJ9`;
            await page.goto(searchUrl, { waitUntil: 'networkidle' });
            await page.waitForTimeout(4000);

            // Deteksi text postingan di feed
            const postSelector = 'div[role="feed"] [dir="auto"]';
            const postText = await page.locator(postSelector).first().innerText().catch(() => null);

            if (!postText || postText.length < 15) {
                log.warn(`Skip keyword [${target.keyword}], struktur postingan tidak terbaca.`);
                continue;
            }

            log.info(`Menganalisis Konten Post: "${postText.substring(0, 60)}..."`);

            // Lempar ke AI Agent Gemini untuk Analisis Kelayakan Postingan
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `
                    Analisis teks postingan Facebook ini secara teliti: "${postText}"
                    
                    Aturan Evaluasi:
                    1. Apakah orang di postingan ini VALID sedang butuh rekomendasi, ingin beli, atau mencari produk yang berkorelasi dengan tema keyword "${target.keyword}"? (Jawab YA atau TIDAK)
                    2. Jika YA, buat 1 kalimat balasan super santai, tidak kaku, ala bahasa gaul sosmed Indonesia (boleh pake gaya anak Jaksel/slang) untuk memicu dia mengklik link rekomendasi. Jangan sebutkan nama link-nya di dalam kalimat balasan Anda.
                    
                    Format Output WAJIB Menggunakan JSON murni terstruktur seperti di bawah ini:
                    {
                        "cocok": true,
                        "balasan": "Gua ada nih ka rekomendasi yang pas, coba cek aja dulu"
                    }
                `,
                config: { responseMimeType: "application/json" }
            });

            const aiResult = JSON.parse(aiResponse.text);

            if (aiResult.cocok) {
                const textCommentFinal = `${aiResult.balasan} 🔗 ${target.link}`;
                log.success(`🎯 Match Terdeteksi! Kalimat AI: "${aiResult.balasan}"`);

                // Eksekusi Komentar via Playwright
                const btnKomentar = page.locator('text="Komentar"').first(); // sesuaikan text="Comment" jika akun bahasa inggris
                if (await btnKomentar.isVisible()) {
                    await btnKomentar.click();
                    await page.waitForTimeout(2000);

                    const inputField = page.locator('div[role="textbox"]').first();
                    await inputField.fill(textCommentFinal);
                    await page.waitForTimeout(1000);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(3000);

                    // Kirim laporan sukses ke Telegram lo
                    await bot.sendMessage(CONFIG.OWNER_CHAT_ID, 
`✅ *Auto-comment terkirim!*

👤 *Akun:* \`${CONFIG.DEFAULT_ACCOUNT}\`
🔍 *Keyword:* \`${target.keyword}\`
📝 *Postingan Target:* _"${postText.substring(0, 120)}..."_
💬 *Balasan AI:* "${aiResult.balasan}"
🔗 *Link Shopee:* ${target.link}`, { parse_mode: "Markdown" });

                    log.success("Komentar sukses di-inject ke Facebook!");
                }
            } else {
                log.info("⏭️ Hasil AI: Konten post tidak sesuai kebutuhan konversi affiliate, SKIP!");
            }
            
            // Kasih jeda waktu acak 5-10 detik antar keyword biar gak dianggap spam gila-gilaan oleh FB
            await page.waitForTimeout(Math.floor(Math.random() * 5000) + 5000);
        }

    } catch (error) {
        log.error(`Fatal Engine Error: ${error.message}`);
    } finally {
        await browser.close();
        log.info("Proses selesai. Sesi Browser ditutup.");
    }
}

console.log(chalk.green("🤖 Bot Telegram Sniper Mode Active! Menunggu perintah di Telegram..."));
