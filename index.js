// const axios = require("axios");
// const schedule = require("node-schedule");
// const notifier = require("node-notifier");

// const url = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY";
// const headers = {
//   "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
//   Accept: "application/json, text/javascript, */*; q=0.01",
//   "Accept-Language": "en-US,en;q=0.9",
//   Connection: "keep-alive",
//   Referer: "https://www.nseindia.com/option-chain",
//   Host: "www.nseindia.com",
// };

// let previousOI = {};
// const OI_THRESHOLD = 500; // change in OI to trigger a signal

// async function fetchOptionChain() {
//   try {
//     const response = await axios.get(url, { headers });
//     const records = response.data.records.data;

//     records.forEach((item) => {
//       const strike = item.strikePrice;
//       const CE_OI = item.CE ? item.CE.openInterest : 0;
//       const PE_OI = item.PE ? item.PE.openInterest : 0;

//       if (previousOI[strike]) {
//         const ceChange = CE_OI - previousOI[strike].CE;
//         const peChange = PE_OI - previousOI[strike].PE;

//         if (ceChange > OI_THRESHOLD)
//           showSignal(`🔥 Strike ${strike} CE BUY signal! OI +${ceChange}`);
//         if (ceChange < -OI_THRESHOLD)
//           showSignal(`⚡ Strike ${strike} CE SELL signal! OI ${ceChange}`);
//         if (peChange > OI_THRESHOLD)
//           showSignal(`🔥 Strike ${strike} PE SELL signal! OI +${peChange}`);
//         if (peChange < -OI_THRESHOLD)
//           showSignal(`⚡ Strike ${strike} PE BUY signal! OI ${peChange}`);
//       }

//       previousOI[strike] = { CE: CE_OI, PE: PE_OI };
//     });
//   } catch (error) {
//     console.error("Error fetching data:", error.message);
//   }
// }

// function showSignal(message) {
//   console.log(message);
//   notifier.notify({
//     title: "Nifty OI Signal",
//     message: message,
//     sound: true,
//   });
// }

// // Run every 5 seconds
// schedule.scheduleJob("*/5 * * * * *", fetchOptionChain);
// console.log(" Nifty OI Signal Tracker running...");

const axios = require("axios");
const schedule = require("node-schedule");
const notifier = require("node-notifier");
const ExcelJS = require("exceljs");

// ========== SETTINGS ==========
const SYMBOL = "NIFTY";
const STRIKE_GAP = 50; // Nifty strike interval
const STRIKE_RANGE = 4; // ATM ± 4 strikes
const REFRESH_INTERVAL = 5; // in seconds
const EXCEL_FILE = "option_levels.xlsx";

// ========== NSE API ==========
const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${SYMBOL}`;
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Referer: "https://www.nseindia.com/option-chain",
  Host: "www.nseindia.com",
};

// ========== PREVIOUS OI STORAGE ==========
let previousOI = {};

// ========== EXCEL WORKBOOK ==========
const workbook = new ExcelJS.Workbook();

// ========== FETCH OPTION CHAIN ==========
async function fetchOptionChain() {
  try {
    const response = await axios.get(url, { headers });
    const data = response.data.records.data;
    const spot = response.data.records.underlyingValue;

    // Find ATM strike
    const atm = Math.round(spot / STRIKE_GAP) * STRIKE_GAP;
    const strikes = [];
    for (let i = -STRIKE_RANGE; i <= STRIKE_RANGE; i++) {
      strikes.push(atm + i * STRIKE_GAP);
    }

    // Collect OI info for ATM ±4 strikes
    const oiData = strikes.map((strike) => {
      const item = data.find((d) => d.strikePrice === strike) || {};
      const CE = item.CE || {};
      const PE = item.PE || {};
      const CE_OI = CE.openInterest || 0;
      const PE_OI = PE.openInterest || 0;
      const CE_Change = CE.changeinOpenInterest || 0;
      const PE_Change = PE.changeinOpenInterest || 0;

      // Real-time OI delta compared to last fetch
      let CE_RealChange = 0;
      let PE_RealChange = 0;
      if (previousOI[strike]) {
        CE_RealChange = CE_OI - previousOI[strike].CE_OI;
        PE_RealChange = PE_OI - previousOI[strike].PE_OI;
      }

      previousOI[strike] = { CE_OI, PE_OI };

      return {
        strike,
        CE_OI,
        PE_OI,
        CE_Change,
        PE_Change,
        CE_RealChange,
        PE_RealChange,
      };
    });

    // ===== SUPPORT & RESISTANCE BASED ON MAX OI CHANGE =====
    const support = Math.max(
      ...oiData
        .filter((d) => d.strike <= atm)
        .sort((a, b) => b.PE_Change - a.PE_Change)
        .slice(0, 1)
        .map((d) => d.strike),
    );

    const resistance = Math.min(
      ...oiData
        .filter((d) => d.strike >= atm)
        .sort((a, b) => b.CE_Change - a.CE_Change)
        .slice(0, 1)
        .map((d) => d.strike),
    );

    // ===== CALL/PUT BUY LEVELS =====
    const callLevel = resistance + STRIKE_GAP * 0.4;
    const putLevel = support - STRIKE_GAP * 0.4;

    // ===== MARKET BIAS =====
    let bias = "RANGE / NO TRADE";
    if (spot > resistance) bias = "BULLISH";
    else if (spot < support) bias = "BEARISH";

    // ===== DISPLAY SUMMARY =====
    console.log("======== NIFTY OPTION CHAIN ========");
    console.log("Time:", new Date().toLocaleTimeString());
    console.log("Spot:", spot);
    console.log("ATM:", atm);
    console.log("Support:", support, "Resistance:", resistance);
    console.log("CALL Buy Level:", callLevel.toFixed(2));
    console.log("PUT Buy Level:", putLevel.toFixed(2));
    console.log("Bias:", bias);
    console.log("Strikes Data:", oiData);
    console.log("===================================");

    // ===== DESKTOP NOTIFICATION =====
    notifier.notify({
      title: "Nifty OI Summary",
      message: `Spot: ${spot} | Bias: ${bias} | Support: ${support} | Resistance: ${resistance}`,
      sound: true,
    });

    // ===== SAVE TO EXCEL =====
    await saveToExcel(oiData, {
      Time: new Date().toLocaleTimeString(),
      Spot: spot,
      ATM: atm,
      Support: support,
      Resistance: resistance,
      CALL_Buy_Level: callLevel.toFixed(2),
      PUT_Buy_Level: putLevel.toFixed(2),
      Bias: bias,
    });
  } catch (err) {
    console.error("Error fetching option chain:", err.message);
  }
}

// ========== SAVE TO EXCEL FUNCTION ==========
async function saveToExcel(oiData, summary) {
  try {
    // Clear workbook before writing
    workbook.eachSheet((sheet) => {
      workbook.removeWorksheet(sheet.id);
    });

    const wsData = workbook.addWorksheet("OI_Data");
    wsData.columns = [
      { header: "Strike", key: "strike", width: 10 },
      { header: "CE_OI", key: "CE_OI", width: 12 },
      { header: "PE_OI", key: "PE_OI", width: 12 },
      { header: "CE_Change", key: "CE_Change", width: 12 },
      { header: "PE_Change", key: "PE_Change", width: 12 },
      { header: "CE_RealChange", key: "CE_RealChange", width: 14 },
      { header: "PE_RealChange", key: "PE_RealChange", width: 14 },
    ];

    oiData.forEach((d) => wsData.addRow(d));

    const wsSummary = workbook.addWorksheet("Summary");
    wsSummary.columns = Object.keys(summary).map((k) => ({
      header: k,
      key: k,
      width: 15,
    }));

    wsSummary.addRow(summary);

    await workbook.xlsx.writeFile(EXCEL_FILE);
    console.log("Excel updated:", EXCEL_FILE);
  } catch (err) {
    console.error("Error writing Excel:", err.message);
  }
}

// ========== SCHEDULE ==========
schedule.scheduleJob(`*/${REFRESH_INTERVAL} * * * * *`, fetchOptionChain);
console.log("Nifty OI Signal Tracker running...");
