// index.js
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import dayjs from "dayjs";

const REVIVE_URL = "https://revive.adgeek.net/admin/index.php";
const USER = process.env.REVIVE_USER;
const PASS = process.env.REVIVE_PASS;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function loginAndFetchStats() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));

  // Step 1: login page
  const loginPage = await client.get(REVIVE_URL);
  const $ = cheerio.load(loginPage.data);
  const token = $("input[name=oa_cookiecheck]").attr("value");

  // Step 2: login
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
      maxRedirects: 0,
      validateStatus: (status) => status === 302 || status === 200,
    }
  );

  if (loginResp.status !== 302) {
    console.error("❌ Login failed");
    return;
  }
  console.log("✅ Login success");

  // Step 3: decide period (yesterday or today)
  const now = dayjs();
  let periodStart, periodEnd, label;

  if (now.hour() < 1) {
    // 00:00–00:59 → yesterday
    periodStart = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    periodEnd = periodStart;
    label = "昨日";
  } else {
    // 01:00–23:59 → today
    periodStart = now.format("YYYY-MM-DD");
    periodEnd = periodStart;
    label = "今日";
  }

  console.log(`⏰ 抓取期間: ${periodStart} ~ ${periodEnd} (${label})`);

  const statsUrl = `https://revive.adgeek.net/admin/stats.php?entity=global&breakdown=advertiser&period_start=${periodStart}&period_end=${periodEnd}`;
  const statsResp = await client.get(statsUrl);
  const $$ = cheerio.load(statsResp.data);

  // Step 4: parse table
  let advertisers = [];
  $$("table.table tbody tr").each((i, row) => {
    const cols = $$(row).find("td");
    if (cols.length >= 5) {
      const name = $$(cols[0]).text().trim();
      const clicks = $$(cols[4]).text().trim();

      const anchor = $$(cols[0]).find("a[href*='clientid=']").first();
      const href = anchor.attr("href") || "";
      const match = href.match(/clientid=(\d+)/);
      const id = match ? match[1] : "-";

      if (name && clicks) {
        advertisers.push({
          name,
          id,
          clicks: parseInt(clicks.replace(/,/g, ""), 10),
        });
      }
    }
  });

  console.log("Parsed advertisers:", advertisers);

  // Step 5: total clicks
  const totalClicks = advertisers.reduce((sum, a) => sum + (a.clicks || 0), 0);

  // Step 6: build Telegram message
  let message = `📊 Revive 點擊數 (${label} ${periodStart})\n\n`;
  advertisers.forEach((ad) => {
    message += `${ad.name} (ID: ${ad.id}) → ${ad.clicks}\n`;
  });

  // Step 7: send to Telegram
  if (TG_TOKEN && TG_CHAT_ID) {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID,
      text: message,
    });
    console.log("✅ Sent to Telegram!");
  }
}

loginAndFetchStats().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
