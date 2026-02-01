const axios = require("axios");
const fs = require("fs");
const schedule = require("node-schedule");
const notifier = require("node-notifier");

const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");
const randomUseragent = require("random-useragent");
const https = require("https");

// ================= CONFIG =================

const SYMBOL = "NIFTY";
const STRIKE_GAP = 50;
const STRIKE_RANGE = 4;
const INTERVAL = 10;

const PINE_FILE = "nifty_oi_auto.pine";

// ================= COOKIE SESSION =================

const jar = new tough.CookieJar();

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 1,
});

const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    httpsAgent: agent,
    timeout: 20000,
  }),
);

// ================= HEADERS =================

function headers() {
  return {
    "User-Agent": randomUseragent.getRandom(),
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.nseindia.com/option-chain",
    Connection: "keep-alive",
  };
}

// ================= DELAY =================

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= MAIN FUNCTION =================

async function fetchOptionChain() {
  try {
    // --------- Step 1 : homepage warmup ----------
    await client.get("https://www.nseindia.com", {
      headers: headers(),
    });

    await wait(1500);

    // --------- Step 2 : option API ----------
    const res = await client.get(
      `https://www.nseindia.com/api/option-chain-indices?symbol=${SYMBOL}`,
      {
        headers: headers(),
      },
    );

    if (!res.data?.records?.data) {
      console.log("❌ Empty NSE response");
      return;
    }

    const spot = res.data.records.underlyingValue;
    const data = res.data.records.data;

    const atm = Math.round(spot / STRIKE_GAP) * STRIKE_GAP;

    const strikes = [];

    for (let i = -STRIKE_RANGE; i <= STRIKE_RANGE; i++) {
      strikes.push(atm + i * STRIKE_GAP);
    }

    const oiData = strikes.map((strike) => {
      const item = data.find((d) => d.strikePrice === strike) || {};
      return {
        strike,
        CE: item.CE?.changeinOpenInterest || 0,
        PE: item.PE?.changeinOpenInterest || 0,
      };
    });

    const support =
      oiData.filter((x) => x.strike <= atm).sort((a, b) => b.PE - a.PE)[0]
        ?.strike || atm;

    const resistance =
      oiData.filter((x) => x.strike >= atm).sort((a, b) => b.CE - a.CE)[0]
        ?.strike || atm;

    const callLevel = resistance + STRIKE_GAP * 0.4;
    const putLevel = support - STRIKE_GAP * 0.4;

    let bias = "RANGE";
    if (spot > resistance) bias = "BULLISH";
    else if (spot < support) bias = "BEARISH";

    console.clear();

    console.log("====== NIFTY LIVE OI ======");
    console.log("Spot:", spot);
    console.log("ATM:", atm);
    console.log("Support:", support);
    console.log("Resistance:", resistance);
    console.log("CALL:", callLevel.toFixed(2));
    console.log("PUT:", putLevel.toFixed(2));
    console.log("Bias:", bias);
    console.log("===========================");

    notifier.notify({
      title: "NIFTY OI",
      message: `Bias: ${bias} | Spot: ${spot}`,
      sound: true,
    });

    generatePine({ support, resistance, callLevel, putLevel });
  } catch (err) {
    console.log("❌ BLOCKED:", err.response?.status || err.message);
  }
}

// ================= PINE SCRIPT =================

function generatePine(d) {
  const pine = `//@version=6
indicator("NIFTY AUTO OI", overlay=true)

plot(${d.support}, "Support", color=color.green, linewidth=2)
plot(${d.resistance}, "Resistance", color=color.red, linewidth=2)
plot(${d.callLevel.toFixed(2)}, "Call", color=color.blue)
plot(${d.putLevel.toFixed(2)}, "Put", color=color.orange)
`;

  fs.writeFileSync(PINE_FILE, pine);
}

// ================= RUN =================

schedule.scheduleJob(`*/${INTERVAL} * * * * *`, fetchOptionChain);

console.log("🚀 BOT RUNNING...");
