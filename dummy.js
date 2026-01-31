const fs = require("fs");

// ========== SETTINGS ==========
const STRIKE_GAP = 50;
const STRIKE_RANGE = 2; // ATM ±2 strikes
const SAMPLE_FILE = "sample_nifty.json";
const PINE_FILE = "nifty_oi_auto.pine";

// ========== LOAD SAMPLE DATA ==========
function loadSampleData() {
  const raw = fs.readFileSync(SAMPLE_FILE, "utf8");
  return JSON.parse(raw);
}

// ========== MAIN FUNCTION ==========
function processDummyData() {
  const json = loadSampleData();

  const spot = json.records.underlyingValue;
  const data = json.records.data;

  // ===== FIND ATM =====
  const atm = Math.round(spot / STRIKE_GAP) * STRIKE_GAP;

  // ===== STRIKE RANGE =====
  const strikes = [];
  for (let i = -STRIKE_RANGE; i <= STRIKE_RANGE; i++) {
    strikes.push(atm + i * STRIKE_GAP);
  }

  // ===== EXTRACT OI DATA =====
  const oiData = strikes.map((strike) => {
    const item = data.find((d) => d.strikePrice === strike) || {};
    const CE = item.CE || {};
    const PE = item.PE || {};

    return {
      strike,
      CE_Change: CE.changeinOpenInterest || 0,
      PE_Change: PE.changeinOpenInterest || 0,
    };
  });

  // ===== SUPPORT (MAX PE CHANGE BELOW ATM) =====
  const peSide = oiData.filter((d) => d.strike <= atm);
  const support =
    peSide.length > 0
      ? peSide.sort((a, b) => b.PE_Change - a.PE_Change)[0].strike
      : atm;

  // ===== RESISTANCE (MAX CE CHANGE ABOVE ATM) =====
  const ceSide = oiData.filter((d) => d.strike >= atm);
  const resistance =
    ceSide.length > 0
      ? ceSide.sort((a, b) => b.CE_Change - a.CE_Change)[0].strike
      : atm;

  // ===== BUY LEVELS =====
  const callLevel = resistance + STRIKE_GAP * 0.4;
  const putLevel = support - STRIKE_GAP * 0.4;

  // ===== BIAS =====
  let bias = "RANGE / NO TRADE";
  if (spot > resistance) bias = "BULLISH";
  else if (spot < support) bias = "BEARISH";

  // ===== OUTPUT =====
  console.log("\n====== DUMMY OI TEST ======");
  console.log("Spot:", spot);
  console.log("ATM:", atm);
  console.log("Support:", support);
  console.log("Resistance:", resistance);
  console.log("CALL Buy Level:", callLevel.toFixed(2));
  console.log("PUT Buy Level:", putLevel.toFixed(2));
  console.log("Bias:", bias);
  console.log("===========================");

  // ===== GENERATE PINE SCRIPT =====
  generatePineScript({
    atm,
    support,
    resistance,
    callLevel,
    putLevel,
  });
}

// ========== PINE SCRIPT GENERATOR ==========
function generatePineScript(levels) {
  const pine = `//@version=6
indicator("NIFTY OI Signal Tracker (AUTO)", overlay=true)

// ===== AUTO GENERATED FROM NODE.JS =====
atm        = input.int(${levels.atm}, "ATM Strike")
support    = input.int(${levels.support}, "Support")
resistance = input.int(${levels.resistance}, "Resistance")
callLevel  = input.float(${levels.callLevel.toFixed(2)}, "CALL Buy Level")
putLevel   = input.float(${levels.putLevel.toFixed(2)}, "PUT Buy Level")

spot = hl2

// ===== BIAS LOGIC =====
bias =
     spot > resistance ? "BULLISH" :
     spot < support    ? "BEARISH" :
                          "RANGE / NO TRADE"

// ===== LEVEL PLOTS =====
plot(support, title="Support", color=color.green, linewidth=2)
plot(resistance, title="Resistance", color=color.red, linewidth=2)
plot(callLevel, title="CALL Level", color=color.blue, linewidth=2)
plot(putLevel, title="PUT Level", color=color.orange, linewidth=2)

// ===== BACKGROUND TREND =====
bgcolor(
     bias == "BULLISH" ? color.new(color.green, 85) :
     bias == "BEARISH" ? color.new(color.red, 85) :
                         na
)

// ===== SINGLE LIVE LABEL =====
var label biasLabel = na

if barstate.islast
    label.delete(biasLabel)

    biasLabel := label.new(
        bar_index,
        spot,
        bias,
        style = label.style_label_down,
        color = color.yellow,
        textcolor = color.black
    )
`;

  fs.writeFileSync(PINE_FILE, pine);

  console.log("\n✅ Pine Script Generated Successfully");
  console.log("📄 File:", PINE_FILE);
  console.log("👉 Copy & paste into TradingView Pine Editor");
}

// ========== RUN ==========
processDummyData();
