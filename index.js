const axios = require("axios");
const schedule = require("node-schedule");
const notifier = require("node-notifier");
const ExcelJS = require("exceljs");
const fs = require("fs");

// ========== SETTINGS ==========
const SYMBOL = "NIFTY";
const STRIKE_GAP = 50; // Nifty strike interval
const STRIKE_RANGE = 4; // ATM ± 4 strikes
const REFRESH_INTERVAL = 5; // in seconds
const EXCEL_FILE = "option_levels.xlsx";
const PINE_FILE = "nifty_oi_pine.ts"; // Pine Script output

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

    // Collect OI info for ATM ±4 strikes
    const oiData = [];
    for (let i = -STRIKE_RANGE; i <= STRIKE_RANGE; i++) {
      const strike = atm + i * STRIKE_GAP;
      const item = data.find((d) => d.strikePrice === strike) || {};
      const CE = item.CE || {};
      const PE = item.PE || {};
      const CE_OI = CE.openInterest || 0;
      const PE_OI = PE.openInterest || 0;
      const CE_Change = CE.changeinOpenInterest || 0;
      const PE_Change = PE.changeinOpenInterest || 0;

      let CE_RealChange = 0;
      let PE_RealChange = 0;
      if (previousOI[strike]) {
        CE_RealChange = CE_OI - previousOI[strike].CE_OI;
        PE_RealChange = PE_OI - previousOI[strike].PE_OI;
      }

      previousOI[strike] = { CE_OI, PE_OI };

      oiData.push({
        strike,
        CE_OI,
        PE_OI,
        CE_Change,
        PE_Change,
        CE_RealChange,
        PE_RealChange,
      });
    }

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
    console.log(
      "Spot:",
      spot,
      "ATM:",
      atm,
      "Support:",
      support,
      "Resistance:",
      resistance,
      "CALL:",
      callLevel.toFixed(2),
      "PUT:",
      putLevel.toFixed(2),
      "Bias:",
      bias,
    );

    // ===== DESKTOP NOTIFICATION =====
    notifier.notify({
      title: "Nifty OI Summary",
      message: `Spot: ${spot} | Bias: ${bias} | Support: ${support} | Resistance: ${resistance}`,
      sound: true,
    });

    // ===== SAVE TO EXCEL =====
    // await saveToExcel(oiData, {
    //   Time: new Date().toLocaleTimeString(),
    //   Spot: spot,
    //   ATM: atm,
    //   Support: support,
    //   Resistance: resistance,
    //   CALL_Buy_Level: callLevel.toFixed(2),
    //   PUT_Buy_Level: putLevel.toFixed(2),
    //   Bias: bias,
    // });

    // ===== SAVE TO PINE SCRIPT =====
    saveToPineScript({ atm, support, resistance, callLevel, putLevel });
  } catch (err) {
    console.error("Error fetching option chain:", err.message);
  }
}

// ========== SAVE TO EXCEL FUNCTION ==========
async function saveToExcel(oiData, summary) {
  try {
    workbook.eachSheet((sheet) => workbook.removeWorksheet(sheet.id));
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

// ========== SAVE TO PINE SCRIPT FUNCTION ==========
function saveToPineScript(levels) {
  const content = `//@version=5
indicator("NIFTY OI Signal Tracker", overlay=true)

atm = input.int(${levels.atm}, "ATM Strike")
support = input.int(${levels.support}, "Support")
resistance = input.int(${levels.resistance}, "Resistance")
callLevel = input.float(${levels.callLevel.toFixed(2)}, "CALL Buy Level")
putLevel = input.float(${levels.putLevel.toFixed(2)}, "PUT Buy Level")

spot = close
bias = spot > resistance ? "BULLISH" : spot < support ? "BEARISH" : "RANGE / NO TRADE"

plot(support, color=color.green, title="Support")
plot(resistance, color=color.red, title="Resistance")
plot(callLevel, color=color.blue, title="CALL Level")
plot(putLevel, color=color.orange, title="PUT Level")

label.new(bar_index, spot, text=bias, color=color.yellow, textcolor=color.black)
`;
  fs.writeFileSync(PINE_FILE, content);
  console.log("Pine Script updated:", PINE_FILE);
}

// ========== SCHEDULE ==========
schedule.scheduleJob(`*/${REFRESH_INTERVAL} * * * * *`, fetchOptionChain);
console.log("Nifty OI Signal Tracker running...");
