require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const https = require("https");
const http = require("http");

// ===== Konfiguratsiya =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_TOKEN || !GEMINI_KEY) {
  console.error("❌ TELEGRAM_BOT_TOKEN yoki GEMINI_API_KEY .env faylida topilmadi!");
  process.exit(1);
}

// ===== Dobbi system prompt =====
const SYSTEM_PROMPT = `Act as Dobbi🧙🏾‍♂️, a conductor of expert agents. Your job is to support the user in accomplishing their goals by aligning with their goals and preference, then calling upon an expert agent perfectly suited to the task by initializing "Dobbi_COR" = "\${emoji}: I am an expert in \${role}. I know \${context}. I will reason step-by-step to determine the best course of action to achieve \${goal}. I can use \${tools} to help in this process

I will help you accomplish your goal by following these steps:

\${reasoned steps}

My task ends when \${completion}.

\${first step, question}."

Follow these steps:

1. 🧙🏾‍♂️, Start each interaction by gathering context, relevant information and clarifying the user's goals by asking them questions

2. Once user has confirmed, initialize "Dobbi_CoR"

3. 🧙🏾‍♂️ and the expert agent, support the user until the goal is accomplished

Commands:

/start - introduce yourself and begin with step one
/save - restate SMART goal, summarize progress so far, and recommend a next step
/reason - Dobbi and Agent reason step by step together and make a recommendation for how the user should proceed
/settings - update goal or agent
/new - Forget previous input

Rules:

-End every output with a question or a recommended next step
-List your commands in your first output or if the user asks
-🧙🏾‍♂️, ask before generating a new agent
-Write in Uzbek language!`;

// ===== Telegram Bot =====
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ===== Gemini AI =====
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: SYSTEM_PROMPT,
});

// ===== Chat tarixini saqlash (har bir foydalanuvchi uchun) =====
const chatSessions = new Map();

function getChatSession(chatId) {
  if (!chatSessions.has(chatId)) {
    const chat = model.startChat({
      history: [],
      generationConfig: {
        maxOutputTokens: 2048,
      },
    });
    chatSessions.set(chatId, chat);
  }
  return chatSessions.get(chatId);
}

// ===== /start komandasi =====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || "Do'stim";

  // Yangi suhbat boshlash
  chatSessions.delete(chatId);

  bot.sendMessage(
    chatId,
    `🤖 Salom, ${name}!\n\nMen *Dobby* — Gemini AI bilan ishlaydigan aqlli botman.\n\nMenga istalgan savolingizni yuboring, men javob beraman! 🧠\n\n📌 Buyruqlar:\n/start — Qayta boshlash\n/help — Yordam\n/clear — Suhbat tarixini tozalash`,
    { parse_mode: "Markdown" }
  );
});

// ===== /help komandasi =====
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📖 *Yordam*\n\nMen Google Gemini AI asosida ishlayman.\n\n🔹 Menga istalgan savolingizni matn ko'rinishida yuboring\n🔹 Men kontekstni eslab qolaman — suhbatni davom ettiring!\n🔹 Yangi mavzuga o'tish uchun /clear bosing\n\n📌 *Buyruqlar:*\n/start — Qayta boshlash\n/help — Shu yordam\n/clear — Suhbat tarixini tozalash`,
    { parse_mode: "Markdown" }
  );
});

// ===== /clear komandasi =====
bot.onText(/\/clear/, (msg) => {
  const chatId = msg.chat.id;
  chatSessions.delete(chatId);
  bot.sendMessage(chatId, "🧹 Suhbat tarixi tozalandi. Yangi suhbat boshlashingiz mumkin!");
});

// ===== Rasmni yuklash funksiyasi =====
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ===== Foto xabarlarni qayta ishlash =====
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const caption = msg.caption || "Bu rasmda nima bor? Tahlil qilib ber.";

  // Buyruqlarni o'tkazib yuborish
  if (caption.startsWith("/")) return;

  bot.sendChatAction(chatId, "typing");

  try {
    // Eng katta o'lchamdagi rasmni olish
    const photo = msg.photo[msg.photo.length - 1];
    const fileInfo = await bot.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.file_path}`;

    // Rasmni yuklash
    const imageBuffer = await downloadFile(fileUrl);
    const base64Image = imageBuffer.toString("base64");

    // Rasm formatini aniqlash
    const ext = fileInfo.file_path.split(".").pop().toLowerCase();
    const mimeTypes = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    const mimeType = mimeTypes[ext] || "image/jpeg";

    // Gemini ga rasm + matn yuborish
    const chat = getChatSession(chatId);
    const result = await chat.sendMessage([
      { text: caption },
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
    ]);

    const response = result.response.text();

    if (response.length > 4096) {
      for (let i = 0; i < response.length; i += 4096) {
        await bot.sendMessage(chatId, response.substring(i, i + 4096));
      }
    } else {
      await bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error("Rasm xatosi:", error.message);
    bot.sendMessage(chatId, "❌ Rasmni qayta ishlashda xatolik yuz berdi. Qaytadan urinib ko'ring.");
  }
});

// ===== Har bir matnli xabarga Gemini orqali javob berish =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Buyruqlar, rasm va matn bo'lmagan xabarlarni o'tkazib yuborish
  if (!text || text.startsWith("/") || msg.photo) return;

  // "Yozmoqda..." ko'rsatish
  bot.sendChatAction(chatId, "typing");

  try {
    const chat = getChatSession(chatId);
    const result = await chat.sendMessage(text);
    const response = result.response.text();

    // Telegram xabar uzunligi limiti — 4096 belgi
    if (response.length > 4096) {
      // Uzun javoblarni bo'lib yuborish
      for (let i = 0; i < response.length; i += 4096) {
        await bot.sendMessage(chatId, response.substring(i, i + 4096));
      }
    } else {
      await bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error("Gemini xatosi:", error.message);

    let errorMsg = "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.";
    if (error.message.includes("SAFETY")) {
      errorMsg = "⚠️ Bu savolga javob berish imkoni yo'q (xavfsizlik sababli).";
    } else if (error.message.includes("quota") || error.message.includes("429")) {
      errorMsg = "⏳ So'rovlar limiti tugadi. Biroz kutib, qaytadan urinib ko'ring.";
    }

    bot.sendMessage(chatId, errorMsg);
  }
});

// ===== Bot ishga tushdi =====
console.log("🤖 Dobby bot ishga tushdi! Telegram'da xabar yuboring...");

// ===== Graceful shutdown =====
process.on("SIGINT", () => {
  console.log("\n👋 Bot to'xtatilmoqda...");
  bot.stopPolling();
  process.exit(0);
});
