const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ========================
// CONFIG — set these as
// Environment Variables
// on Render (never hardcode)
// ========================
const CONFIG = {
  VERIFY_TOKEN:       process.env.VERIFY_TOKEN || "my_verify_token",
  PAGE_ACCESS_TOKEN:  process.env.PAGE_ACCESS_TOKEN || "",
  ANTHROPIC_API_KEY:  process.env.ANTHROPIC_API_KEY || "",

  // The AI personality — customize this!
  BOT_PERSONA: process.env.BOT_PERSONA ||
    `You are a warm, friendly, and helpful Facebook Page assistant.
    
    Rules you MUST follow:
    - Always greet the user by their first name at the start of your reply (e.g. "Hey Sarah!" or "Hi Mark!")
    - Keep replies to 2-3 sentences maximum
    - Sound natural and human — never robotic or stiff
    - Use 1-2 relevant emojis per reply
    - If someone asks a question you can't answer, say: "Great question! Slide into our DMs and we'll help you out 😊"
    - If someone says hi/hello/hey, greet them back warmly and ask how you can help
    - If someone complains, be empathetic and offer to resolve it via DM
    - Never say you are an AI or a bot`,
};

// ========================
// WEBHOOK VERIFICATION
// ========================
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    return res.status(200).send(challenge);
  }
  console.log("❌ Webhook verification failed");
  res.sendStatus(403);
});

// ========================
// RECEIVE COMMENTS
// ========================
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  for (const entry of body.entry) {
    for (const change of entry.changes) {

      // Only handle new comments on posts
      if (change.field !== "feed") continue;
      if (change.value.item !== "comment") continue;
      if (change.value.verb !== "add") continue;

      const data        = change.value;
      const commentId   = data.comment_id;
      const commentText = data.message || "";
      const fullName    = data.from?.name || "friend";
      const postId      = data.post_id;

      // Use first name for natural greeting
      const firstName = fullName.split(" ")[0];

      console.log(`\n💬 New comment from ${fullName}: "${commentText}"`);

      const reply = await generateAIReply(commentText, firstName, postId);
      await postReply(commentId, reply);
    }
  }

  res.sendStatus(200);
});

// ========================
// AI REPLY GENERATOR
// ========================
async function generateAIReply(commentText, firstName, postId) {
  try {
    // Try to get the original post text for better context
    let postContent = "";
    try {
      const postRes = await axios.get(
        `https://graph.facebook.com/v19.0/${postId}`,
        { params: { fields: "message", access_token: CONFIG.PAGE_ACCESS_TOKEN } }
      );
      postContent = postRes.data?.message || "";
    } catch (_) {
      // Not critical if this fails
    }

    const contextLine = postContent
      ? `The Facebook post context: "${postContent}"\n\n`
      : "";

    const userPrompt =
      `${contextLine}` +
      `A Facebook user named ${firstName} just commented on our page post.\n` +
      `Their comment: "${commentText}"\n\n` +
      `Write a reply that greets ${firstName} by name and responds helpfully to their comment.`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 150,
        system: CONFIG.BOT_PERSONA,
        messages: [{ role: "user", content: userPrompt }],
      },
      {
        headers: {
          "x-api-key":          CONFIG.ANTHROPIC_API_KEY,
          "anthropic-version":  "2023-06-01",
          "Content-Type":       "application/json",
        },
      }
    );

    const reply = response.data.content?.[0]?.text?.trim();
    console.log(`🤖 AI reply: ${reply}`);
    return reply || fallbackReply(firstName);

  } catch (err) {
    console.error("❌ Claude API error:", err.response?.data || err.message);
    return fallbackReply(firstName);
  }
}

// ========================
// FALLBACK (if AI fails)
// ========================
function fallbackReply(firstName) {
  const replies = [
    `Hey ${firstName}! Thanks so much for your comment 😊 We'll get back to you shortly!`,
    `Hi ${firstName}! We appreciate you reaching out 🙏 Someone from our team will follow up soon!`,
    `Hey ${firstName}! Thanks for engaging with us 😄 We'll be in touch!`,
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

// ========================
// POST REPLY TO FACEBOOK
// ========================
async function postReply(commentId, message) {
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${commentId}/comments`,
      { message, access_token: CONFIG.PAGE_ACCESS_TOKEN }
    );
    console.log(`✅ Reply posted! ID: ${res.data.id}`);
  } catch (err) {
    console.error("❌ Failed to post reply:", err.response?.data || err.message);
  }
}

// ========================
// HEALTH CHECK (Render)
// ========================
app.get("/", (_req, res) => {
  res.send("🤖 FB AI Comment Bot is running!");
});

// ========================
// START SERVER
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot is live on port ${PORT}`);
});
