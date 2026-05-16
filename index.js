const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

// =========================================================================
// CONFIGURATION (Taruh data lo di sini, ga usah pake .env)
// =========================================================================
const GEMINI_API_KEY = "TARUH_API_KEY_GEMINI_LO_DI_SINI"; 

// Konfigurasi Akun & Session
const AKUN_SEKARANG = "akun_1"; // Ganti namanya kalau mau pake akun berbeda (misal: akun_2)
const SESSION_FILE = path.join(__dirname, `session_${AKUN_SEKARANG}.json`);

// Link Shopee Affiliate Induk lo
const LINK_AFFILIATE = "https://shope.ee/xxxxxx"; 
const KEYWORD_CARI = "nyari hp cianjur";
// =========================================================================

// Inisialisasi API Gemini
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function runBot() {
  // 1. Launch Browser (headless: false biar lu bisa mantau browsernya jalan)
  const browser = await chromium.launch({ headless: false });
  let context;

  // 2. CEK COOKIES / SESSION JSON
  if (fs.existsSync(SESSION_FILE)) {
    console.log(`📦 Menemukan session lama untuk [${AKUN_SEKARANG}]. Membuka browser langsung login...`);
    // Load session JSON yang udah kesimpen
    context = await browser.newContext({ storageState: SESSION_FILE });
  } else {
    console.log(`❌ Session untuk [${AKUN_SEKARANG}] tidak ditemukan. Lo harus login manual dulu!`);
    context = await browser.newContext();
  }

  const page = await context.newPage();

  // 3. LOGIKA JALUR LOGIN ATAU LANGSUNG GAS
  await page.goto('https://www.facebook.com/');

  // Cek apakah ada tombol login atau form input email. Kalo ada, berarti belum login
  const isNeedLogin = await page.locator('input[name="email"]').isVisible().catch(() => false);

  if (isNeedLogin) {
    console.log("⚠️ Browser mendeteksi kamu belum login. Silahkan LOGIN MANUAL sekarang di browser yang kebuka!");
    console.log("⏳ Menunggu kamu beresin login... (Diberi waktu 60 detik)");
    
    // Bot bakal nunggu lo ngetik email + pass + OTP (kalau ada) sampai masuk beranda
    await page.waitForURL('**/facebook.com/**', { timeout: 60000 });
    await page.waitForTimeout(5000); // Kasih jeda biar ke-load semua

    // Simpan session baru ke file JSON setelah lo berhasil login
    const storage = await context.storageState();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));
    console.log(`✅ Session baru berhasil disimpan ke: ${SESSION_FILE}`);
    console.log("🔄 Jalankan ulang script ini buat mulai nyari target otomatis!");
    await browser.close();
    return;
  }

  console.log("🔥 Login Valid! Langsung gass cari target...");

  // 4. CARI POSTINGAN GLOBAL BERDASARKAN KEYWORD
  console.log(`🔍 Nembak pencarian keyword: "${KEYWORD_CARI}"`);
  const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(KEYWORD_CARI)}&filters=eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJndXNcIjpcIlwifSJ9`;
  await page.goto(searchUrl);
  await page.waitForTimeout(5000); // Tunggu loading feed pencarian

  // 5. AMBIL TEKS POSTINGAN (Selector kasarnya, FB sering update strukturnya)
  // Ini mengambil text dari postingan pertama yang muncul di feed pencarian
  const postSelector = 'div[role="feed"] [dir="auto"]';
  const postText = await page.locator(postSelector).first().innerText().catch(() => null);

  if (!postText || postText.length < 10) {
    console.log("❌ Gagal nyecan teks postingan. Cari keyword lain atau cek selector.");
    await browser.close();
    return;
  }

  console.log(`📝 Teks Postingan Target: "${postText.substring(0, 80)}..."`);

  // 6. LEMPAR KE OTAK GEMINI (Biar mikir gaya bahasa & kelayakan post)
  console.log("🧠 Meminta Gemini menganalisis konteks...");
  try {
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `
        Analisis teks postingan Facebook ini: "${postText}"
        
        Tugas Anda:
        1. Cek apakah orang ini BENAR-BENAR sedang butuh/ingin membeli suatu barang? (Jawab YA atau TIDAK)
        2. Jika YA, buatkan 1 kalimat balasan kasual ala Gen Z Jaksel atau Indonesia santai yang menawarkan produk, singkat, padat, dan natural (Jangan kaku!).
        
        Format output WAJIB JSON murni seperti ini:
        {
          "cocok": true,
          "balasan": "Ada nih kak, coba lirik dulu link ini kali aja sreg"
        }
      `,
      config: { responseMimeType: "application/json" }
    });

    const result = JSON.parse(aiResponse.text);

    if (result.cocok) {
      console.log(`🎯 Match! Gemini bikin teks: "${result.balasan}"`);
      const teksKomenFinal = `${result.balasan} 🔗 ${LINK_AFFILIATE}`;
      
      console.log(`🚀 Siap ngetik komen: [${teksKomenFinal}]`);
      
      // 7. LOGIKA EKSEKUSI NYEKRIPT TOMBOL KOMEN FB
      // Cari tombol "Comment" / "Komentar" di feed tersebut
      const btnKomentar = page.locator('text="Komentar"').first(); // Atau text="Comment" tergantung bahasa FB-mu
      if (await btnKomentar.isVisible()) {
        await btnKomentar.click();
        await page.waitForTimeout(2000);
        
        // Cari kolom input tempat ngetik
        const kolomNgetik = page.locator('div[role="textbox"]').first();
        await kolomNgetik.fill(teksKomenFinal);
        await page.waitForTimeout(1000);
        await page.keyboard.press('Enter');
        
        console.log("✅ Auto-comment Berhasil Ditempel!");
      } else {
        console.log("❌ Tombol komentar gak ketemu/dikunci.");
      }

    } else {
      console.log("⏭️ Kata Gemini postingannya ga cocok (bukan mau beli barang), SKIP!");
    }

  } catch (err) {
    console.error("❌ Error saat olah data Gemini/Komen:", err.message);
  }

  // Selesai, tutup browser
  await page.waitForTimeout(5000);
  await browser.close();
  console.log("🏁 Proses selesai.");
}

runBot();
