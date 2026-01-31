const axios = require("axios");
const schedule = require("node-schedule");
const notifier = require("node-notifier");

const url = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY";
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Referer: "https://www.nseindia.com/option-chain",
  Host: "www.nseindia.com",
};

let previousOI = {};
const OI_THRESHOLD = 500; // change in OI to trigger a signal

async function fetchOptionChain() {
  try {
    const response = await axios.get(url, { headers });
    const records = response.data.records.data;

    records.forEach((item) => {
      const strike = item.strikePrice;
      const CE_OI = item.CE ? item.CE.openInterest : 0;
      const PE_OI = item.PE ? item.PE.openInterest : 0;

      if (previousOI[strike]) {
        const ceChange = CE_OI - previousOI[strike].CE;
        const peChange = PE_OI - previousOI[strike].PE;

        if (ceChange > OI_THRESHOLD)
          showSignal(`🔥 Strike ${strike} CE BUY signal! OI +${ceChange}`);
        if (ceChange < -OI_THRESHOLD)
          showSignal(`⚡ Strike ${strike} CE SELL signal! OI ${ceChange}`);
        if (peChange > OI_THRESHOLD)
          showSignal(`🔥 Strike ${strike} PE SELL signal! OI +${peChange}`);
        if (peChange < -OI_THRESHOLD)
          showSignal(`⚡ Strike ${strike} PE BUY signal! OI ${peChange}`);
      }

      previousOI[strike] = { CE: CE_OI, PE: PE_OI };
    });
  } catch (error) {
    console.error("Error fetching data:", error.message);
  }
}

function showSignal(message) {
  console.log(message);
  notifier.notify({
    title: "Nifty OI Signal",
    message: message,
    sound: true,
  });
}

// Run every 5 seconds
schedule.scheduleJob("*/5 * * * * *", fetchOptionChain);
console.log(" Nifty OI Signal Tracker running...");
