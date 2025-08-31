import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";

// Debug: 捕捉所有未處理的錯誤
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

// 環境變數
const REVIVE_URL = "https://revive.adgeek.net/admin";
const USERNAME = process.env.REVIVE_USER;
const PASSWORD = process.env.REVIVE_PASS;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!USERNAME || !PASSWORD || !TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const jar = new CookieJar();
const client = wrapper(axios.create({ jar, withCredentials: true }));

async function run() {
  console.log("STEP 1: 取得登入頁面…");
  const loginPage = await client.get(`${REVIVE_URL}/index.php`);
  const $ = cheerio.load(loginPage.data);
  const token = $("input[name=oa_cookiecheck]").val();

  if (!token) {
    console.error("❌ 找不到 oa_cookiecheck token");
    console.log("HTML preview:", loginPage.data.substring(0, 500));
    process.exit(1);
  }

  console.log("✅ Got token:", token);

  console.log("STEP 2: 嘗試登入…");
  const loginResp = await client.post(
    `${REVIVE_URL}/index.php`,
    new URLSearchParams({
      username: USERNAME,
      password: PASSWORD,
      oa_cookiecheck: token,
      login: "Login",
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      maxRedirects: 0, // Revive login 會 302 redirect
      validateStatus: (s) => s < 500,
    }
  );

  if (loginResp.status !== 302 && !loginResp.headers["set-cookie"]) {
    console.error("❌ 登入失敗，收到的內容:");
    console.log(loginResp.data.substring(0, 500));
    process.exit(1);
  }

  console.log("✅ Login success, cookies stored.");

  console.log("STEP 3: 抓取 stats 頁面…");
  const statsResp = await client.get(
    `${REVIVE_URL}/stats.php?entity=global&breakdown=advertiser&period_preset=today`
  );
  const $stats = cheerio.load(statsResp.data);

  // 找 "Total" 那行的 Clicks
  const clicks = $stats("table.table tbody tr td")
    .filter((i, el) => $stats(el).text().trim() === "Total")
    .parent()
    .find("td")
    .eq(4)
    .text()
    .trim();

  if (!clicks) {
    console.error("❌ 沒有抓到 Clicks 數字");
    console.log("HTML preview:", statsResp.data.substring(0, 500));
    process.exit(1);
  }

  console.log("✅ Clicks:", clicks);

  console.log("STEP 4: 發送 Telegram 通知…");
  const msg = `📊 Revive 今日 Clicks: ${clicks}`;
  const tgResp = await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
    }
  );

  if (!tgResp.data.ok) {
    console.error("❌ Telegram 發送失敗:", tgResp.data);
    process.exit(1);
  }

  console.log("✅ 已通知 Telegram:", msg);
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
