// index.js
import fs from "fs";
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import { google } from "googleapis";

// ---- 載入本地 config.json ----
const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const {
  REVIVE_USER,
  REVIVE_PASS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  SHEET_ID,
  GOOGLE_SERVICE_KEY,
} = config;

// ---- Polyfill for Node.js environment ----
if (typeof File === "undefined") {
  global.File = class File extends Blob {
    constructor(chunks, filename, options = {}) {
      super(chunks, options);
      this.name = filename;
      this.lastModified = options.lastModified || Date.now();
    }
  };
}
// -----------------------------------------------------------------

// Revive 參數
const REVIVE_URL = "https://revive.adgeek.net/admin/index.php";
const REVIVE_STATS_URL =
  "https://revive.adgeek.net/admin/stats.php?entity=global&breakdown=advertiser&period_preset=today";

// Google Sheets Auth
const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_SERVICE_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

async function getTargetsFromSheet() {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Sheet1!A:C", // A=advertiser_id, B=advertiser_name, C=daily_target_clicks
  });

  const rows = resp.data.values || [];
  const headers = rows.shift();

  const idIndex = headers.indexOf("advertiser_id");
  const clicksIndex = headers.indexOf("daily_target_clicks");

  // 聚合：同 advertiser_id 多列的 clicks 加總
  const targets = {};
  rows.forEach((r) => {
    const id = r[idIndex];
    const target = parseInt(r[clicksIndex] || 0, 10);
    if (!targets[id]) targets[id] = 0;
    targets[id] += target;
  });

  return targets;
}

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
      username: REVIVE_USER,
      password: REVIVE_PASS,
      oa_cookiecheck: token,
      login: "Login",
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      maxRedirects: 0,
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

  // Step 4: 解析表格
  let advertisers = [];
  $$("table.table tbody tr").each((i, row) => {
    const cols = $$(row).find("td");
    if (cols.length >= 5) {
      const name = $$(cols[0]).text().trim();
      const clicks = parseInt($$(cols[4]).text().trim().replace(/,/g, ""), 10);

      // 嘗試從 href 解析 clientid
      const anchor = $$(cols[0]).find("a[href*='clientid=']").first();
      const href = anchor.attr("href") || "";
      const match = href.match(/clientid=(\d+)/);
      const id = match ? match[1] : "-";

      if (name && clicks >= 0) {
        advertisers.push({ name, id, clicks });
      }
    }
  });

  // Step 5: 從 Google Sheet 抓 target clicks
  const targets = await getTargetsFromSheet();

  // Step 6: 組成訊息
  let message = `📊 Revive 今日點擊統計\n\n`;
  advertisers.forEach((ad) => {
    const target = targets[ad.id] || 0;
    if (target > 0) {
      const percent = ((ad.clicks / target) * 100).toFixed(1);
      message += `${ad.name} (ID: ${ad.id}) → ${ad.clicks} / ${target} (${percent}%)\n`;
    } else {
      message += `${ad.name} (ID: ${ad.id}) → ${ad.clicks}\n`;
    }
  });

  // Step 7: 發送到 Telegram
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
      }
    );
    console.log("✅ Sent to Telegram!");
  }
}

loginAndFetchStats().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
