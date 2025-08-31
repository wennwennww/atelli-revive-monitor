// index.js
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";

// ---- Polyfill for Node.js environment (GitHub Actions runner) ----
global.File = class File extends Blob {
  constructor(chunks, filename, options = {}) {
    super(chunks, options);
    this.name = filename;
    this.lastModified = options.lastModified || Date.now();
  }
};
// -----------------------------------------------------------------

// 從 GitHub Actions secrets 讀取帳密 / TG token
const REVIVE_URL = "https://revive.adgeek.net/admin/index.php";
const REVIVE_STATS_URL = "https://revive.adgeek.net/admin/stats.php?entity=global&breakdown=advertiser&period_preset=today";

const USER = process.env.REVIVE_USER;
const PASS = process.env.REVIVE_PASS;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function loginAndFetchStats() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));

  // Step 1: 取得 login 頁面
  const loginPage = await client.get(REVIVE_URL);
  const $ = cheerio.load(loginPage.data);
  const token = $("input[name=oa_cookiecheck]").attr("value");
  console.log("Got token:", token);

  // Step 2: 登入
  const loginResp = await client.post(
    REVIVE_URL,
    new URLSearchParams({
      username: USER,
      password: PASS,
      oa_cookiecheck: token,
      login: "Login",
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      maxRedirects: 0, // GitHub Actions 需要手動處理 redirect
      validateStatus: (status) => status === 302 || status === 200,
    }
  );

  if (loginResp.status === 302) {
    console.log("Login success, cookies stored.");
  } else {
    console.error("Login failed");
    return;
  }

  // Step 3: 抓 stats 頁面
  const statsResp = await client.get(REVIVE_STATS_URL);
  const $$ = cheerio.load(statsResp.data);

  // 找出 Total 的 clicks
  const clicks = $$("table.table tbody tr td:nth-child(5)").first().text().trim();
  console.log("Clicks:", clicks);

  // Step 4: 發送 Telegram
  if (TG_TOKEN && TG_CHAT_ID) {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID,
      text: `📊 Revive 今日點擊數: ${clicks}`,
    });
    console.log("Sent to Telegram!");
  }
}

loginAndFetchStats().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
