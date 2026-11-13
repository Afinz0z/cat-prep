// Raw marks to an estimated CAT percentile range, using the CAT 2025 slot tables.
// Every slot table gives one estimate; the range runs from the lowest to the highest.

function points(rows) {
  return rows.map(([pct, lo, hi]) => [(lo + hi) / 2, pct]).sort((a, b) => a[0] - b[0]);
}

function fromTable(score, rows) {
  const pts = points(rows);
  if (!pts.length || score < pts[0][0]) return null;
  const last = pts[pts.length - 1];
  if (score >= last[0]) return last[1];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [s0, p0] = pts[i];
    const [s1, p1] = pts[i + 1];
    if (score >= s0 && score < s1) return p0 + ((score - s0) / (s1 - s0)) * (p1 - p0);
  }
  return null;
}

// Rows are [percentile, lowScore, highScore] and overlap, so a score can sit in
// more than one band. Report the lowest and highest band it fits.
function roughLow(score, tables) {
  const rows = tables.roughLowOverall?.rows || [];
  const fits = rows.filter(([, lo, hi]) => score >= lo && score <= hi).map(([p]) => p);
  if (fits.length) {
    const lo = Math.min(...fits);
    const hi = Math.max(...fits);
    return lo === hi ? `around the ${ordinal(lo)} (rough)` : `about the ${ordinal(lo)} to ${ordinal(hi)} (rough)`;
  }
  const below = rows.length && score < Math.min(...rows.map(([, lo]) => lo));
  if (below) return `below about the ${ordinal(Math.min(...rows.map(([p]) => p)))} (rough)`;
  const top = [...rows].reverse().find(([, lo]) => score >= lo);
  return top ? `above the ${ordinal(top[0])} (rough)` : "";
}

// section: "overall" | "varc" | "dilr" | "qa"
export function estimate(score, section, tables) {
  if (!tables?.slots || !Number.isFinite(score)) return null;
  const values = [];
  let below = 0;
  for (const slot of Object.values(tables.slots)) {
    const v = fromTable(score, slot[section] || []);
    if (v === null) below += 1;
    else values.push(v);
  }
  if (!values.length) {
    return { below75: true, text: section === "overall" ? `below the 75th, ${roughLow(score, tables)}` : "below the 75th" };
  }
  const low = below ? 75 : Math.min(...values);
  const high = Math.max(...values);
  return { below75: false, low, high, text: rangeText(low, high, below > 0) };
}

export function ordinal(n) {
  const value = n >= 99 ? Math.round(n * 10) / 10 : Math.round(n);
  if (!Number.isInteger(value)) return `${value}th`;
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${{ 1: "st", 2: "nd", 3: "rd" }[value % 10] || "th"}`;
}

function rangeText(low, high, partial) {
  const a = ordinal(low);
  const b = ordinal(high);
  if (a === b) return `about the ${a}`;
  return partial ? `around the ${a} to ${b}` : `about the ${a} to ${b}`;
}
