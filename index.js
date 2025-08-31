import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";

// 帳號密碼從環境變數讀取
const USERNAME = process.env.REVIVE_USER;
const PASSWORD = process.env.REVIVE_PASS;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const jar = new CookieJar();
const client = wrapper(axios.create({ jar, withCredentials: true }));

// 1. 取得 login 頁 token
async function getLoginToken() {
  const res = await client.get("https://revive.adgeek.net/admin/index.php");
  const $ = cheerio.load(res.data);
  return $("input[name=oa_cookiecheck]").val();
}

// 2. 登入
async function login(token) {
  const formData = new URLSearchParams();
  formData.append("username", USERNAME);
  formData.append("password", PASSWORD);
  formData.append("oa_cookiecheck", token);
  formData.append("login", "Login");

  await client.post(
    "https://revive.adgeek.net/admin/index.php",
    formData.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxRedirects: 5 }
  );
}

// 3. 抓取 stats 頁面
async function fetchStats() {
  const res = await client.get(
    "https://revive.adgeek.net/admin/stats.php?entity=global&breakdown=advertiser&period_preset=today"
  );
  return res.data;
}

// 4. 解析 clicks
function extractClicks(html) {
  const $ = cheerio.load(html);

  const totalClicks = $("table.table tbody tr:first-child td:nth-child(5)").text().trim();
  const advertisers = [];
  $("table.table tbody tr").each((i, el) => {
    const name = $(el).find("td:first").text().trim();
    const clicks = $(el).find("td:nth-child(5)").text().trim();
    if (name && clicks) advertisers.push({ name, clicks });
  });

  return { totalClicks, advertisers };
}

// 5. 發送 Telegram
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" });
}

(async () => {
  try {
    const token = await getLoginToken();
    await login(token);
    const statsHtml = await fetchStats();
    const result = extractClicks(statsHtml);

    let message = `📊 *Revive 今日點擊數*\n\n`;
    message += `總點擊數: *${result.totalClicks}*\n\n`;
    message += `各廣告主:\n`;
    result.advertisers.slice(0, 5).forEach(ad => {
      message += `- ${ad.name}: ${ad.clicks}\n`;
    });
    if (result.advertisers.length > 5) message += `... 共 ${result.advertisers.length} 個廣告主`;

    await sendTelegramMessage(message);
    console.log("✅ 已發送 Telegram 通知");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
