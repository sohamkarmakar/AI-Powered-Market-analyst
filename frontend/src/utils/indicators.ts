export function ema(data: number[], period: number): number[] {
  const result = new Array(data.length).fill(0);
  if (data.length < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function sma(data: number[], period: number): number[] {
  const result = new Array(data.length).fill(0);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result[i] = sum / period;
  }
  return result;
}

export function rsi(closes: number[], period = 14): number[] {
  const result = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const macdForSignal = macdLine.slice(slow - 1);
  const signalEma = ema(macdForSignal, signal);
  const fullSignal = new Array(closes.length).fill(0);
  const histogram = new Array(closes.length).fill(0);
  for (let i = 0; i < signalEma.length; i++) {
    const idx = i + slow - 1;
    if (idx < closes.length) { fullSignal[idx] = signalEma[i]; histogram[idx] = macdLine[idx] - signalEma[i]; }
  }
  return { macdLine, signal: fullSignal, histogram };
}

export function bollingerBands(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(0);
  const lower = new Array(closes.length).fill(0);
  for (let i = period - 1; i < closes.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += Math.pow(closes[j] - mid[i], 2);
    const std = Math.sqrt(variance / period);
    upper[i] = mid[i] + mult * std;
    lower[i] = mid[i] - mult * std;
  }
  return { upper, middle: mid, lower };
}

export function stochastic(highs: number[], lows: number[], closes: number[], kPeriod = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(50);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hiSlice = highs.slice(i - kPeriod + 1, i + 1);
    const loSlice = lows.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...hiSlice), ll = Math.min(...loSlice);
    k[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  return { k, d: sma(k, dPeriod) };
}

export function wildersEma(data: number[], period: number): number[] {
  const result = new Array(data.length).fill(0);
  if (data.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) result[i] = (result[i - 1] * (period - 1) + data[i]) / period;
  return result;
}

export function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const tr = closes.map((_, i) => {
    if (i === 0) return highs[i] - lows[i];
    return Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  });
  return wildersEma(tr, period);
}

export function pivotPoints(high: number, low: number, close: number) {
  const pp = (high + low + close) / 3;
  return {
    pp, r1: 2 * pp - low, r2: pp + (high - low), r3: high + 2 * (pp - low),
    s1: 2 * pp - high, s2: pp - (high - low), s3: low - 2 * (high - pp),
    fr1: pp + 0.382 * (high - low), fr2: pp + 0.618 * (high - low),
    fs1: pp - 0.382 * (high - low), fs2: pp - 0.618 * (high - low),
  };
}

export function technicalRating(closes: number[], highs: number[], lows: number[]) {
  const n = closes.length;
  if (n < 20) return null;
  const last = <T>(a: T[]) => a[a.length - 1] ?? 0;
  const current = closes[n - 1];

  const sma20v = sma(closes, 20);
  const sma50v = n >= 50  ? sma(closes, 50)  : null;
  const sma100v = n >= 100 ? sma(closes, 100) : null;
  const sma200v = n >= 200 ? sma(closes, 200) : null;
  const ema9v  = ema(closes, 9);
  const ema20v = ema(closes, 20);
  const ema50v = n >= 50  ? ema(closes, 50)  : null;

  const rsiV  = rsi(closes);
  const { macdLine, signal: macdSig } = macd(closes);
  const { k: stochK, d: stochD } = stochastic(highs, lows, closes);
  const bb = bollingerBands(closes, 20);
  const atrV = atr(highs, lows, closes);

  let buys = 0, sells = 0, neutrals = 0;
  const signals: Array<{ name: string; signal: "BUY" | "SELL" | "NEUTRAL"; value: string }> = [];

  function addSig(name: string, v: boolean | null, val: number | null) {
    const str = val !== null && isFinite(val) ? val.toFixed(2) : "N/A";
    const sig: "BUY" | "SELL" | "NEUTRAL" = v === true ? "BUY" : v === false ? "SELL" : "NEUTRAL";
    signals.push({ name, signal: sig, value: str });
    if (sig === "BUY") buys++; else if (sig === "SELL") sells++; else neutrals++;
  }

  addSig("SMA 20",  current > last(sma20v) ? true : false,  last(sma20v));
  addSig("SMA 50",  sma50v  ? (current > last(sma50v)  ? true : false) : null, sma50v  ? last(sma50v) : null);
  addSig("SMA 100", sma100v ? (current > last(sma100v) ? true : false) : null, sma100v ? last(sma100v) : null);
  addSig("SMA 200", sma200v ? (current > last(sma200v) ? true : false) : null, sma200v ? last(sma200v) : null);
  addSig("EMA 9",   current > last(ema9v) ? true : false,  last(ema9v));
  addSig("EMA 20",  current > last(ema20v) ? true : false, last(ema20v));
  addSig("EMA 50",  ema50v  ? (current > last(ema50v) ? true : false) : null, ema50v ? last(ema50v) : null);

  const curRSI = last(rsiV);
  addSig("RSI (14)", curRSI < 30 ? true : curRSI > 70 ? false : null, curRSI);

  const curMACD = last(macdLine), curMACDSig = last(macdSig);
  addSig("MACD", curMACD !== 0 ? (curMACD > curMACDSig ? true : false) : null, curMACD);

  const curK = last(stochK);
  addSig("Stochastic %K", curK < 20 ? true : curK > 80 ? false : null, curK);

  const curBBU = last(bb.upper), curBBL = last(bb.lower);
  addSig("Bollinger Bands", current < curBBL ? true : current > curBBU ? false : null, null);

  const goldenCross = sma50v && sma200v ? last(sma50v) > last(sma200v) : null;
  if (goldenCross !== null) addSig("Golden/Death Cross", goldenCross, null);

  const total = buys + sells + neutrals;
  const score = total > 0 ? (buys - sells) / total : 0;
  const overall: "STRONG BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG SELL" =
    score > 0.5 ? "STRONG BUY" : score > 0.15 ? "BUY" : score < -0.5 ? "STRONG SELL" : score < -0.15 ? "SELL" : "NEUTRAL";

  // Build chart data (last 60 bars)
  const slice = <T>(a: T[]) => a.slice(-60);
  const chartData = slice(closes).map((c, i) => ({
    i,
    close: c,
    rsi: slice(rsiV)[i],
    macd: slice(macdLine)[i],
    signal: slice(macdSig)[i],
    histogram: slice(macdLine)[i] - slice(macdSig)[i],
    stochK: slice(stochK)[i],
    stochD: slice(stochD)[i],
    bbUpper: slice(bb.upper)[i],
    bbLower: slice(bb.lower)[i],
    bbMid: slice(bb.middle)[i],
  }));

  return {
    overall, score, buys, sells, neutrals, signals, chartData,
    rsi: curRSI, macd: curMACD, macdSignal: curMACDSig,
    stochK: curK, stochD: last(stochD),
    sma20: last(sma20v),
    sma50: sma50v ? last(sma50v) : null,
    sma200: sma200v ? last(sma200v) : null,
    ema9: last(ema9v), ema20: last(ema20v),
    ema50: ema50v ? last(ema50v) : null,
    bbUpper: curBBU, bbLower: curBBL, bbMid: last(bb.middle),
    atr: last(atrV),
    goldenCross,
  };
}
