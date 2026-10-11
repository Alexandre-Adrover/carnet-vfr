// Rafraîchit data/wx_live.json avec les derniers METAR/TAF (aviationweather.gov / NOAA)
// pour tous les aérodromes français du fichier airports_fr.json.
// Lancé par .github/workflows/update-weather.yml toutes les 15 minutes.

import { readFile, writeFile } from "node:fs/promises";

const BATCH_SIZE = 80; // nombre de codes OACI par requête (évite des URLs trop longues)

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "carnet-vfr-github-actions" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchAll(icaos, kind) {
  const byIcao = new Map();
  for (const batch of chunk(icaos, BATCH_SIZE)) {
    const ids = batch.join(",");
    const url = `https://aviationweather.gov/api/data/${kind}?ids=${encodeURIComponent(ids)}&format=json`;
    try {
      const items = await fetchJson(url);
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item && item.icaoId) byIcao.set(item.icaoId, item);
        }
      }
    } catch (err) {
      console.error(`Échec batch ${kind} (${batch.length} terrains) :`, err.message);
    }
  }
  return byIcao;
}

async function main() {
  const airportsRaw = await readFile(new URL("../airports_fr.json", import.meta.url), "utf-8");
  const airports = JSON.parse(airportsRaw);
  const icaos = airports.map((a) => a.icao).filter(Boolean);

  console.log(`Interrogation de ${icaos.length} aérodromes...`);

  const [metars, tafs] = await Promise.all([
    fetchAll(icaos, "metar"),
    fetchAll(icaos, "taf"),
  ]);

  const fetchedAt = new Date().toISOString();
  const out = {};
  for (const icao of icaos) {
    const metar = metars.get(icao) || null;
    const taf = tafs.get(icao) || null;
    if (metar || taf) {
      out[icao] = { metar, taf, fetchedAt };
    }
  }

  const payload = {
    generatedAt: fetchedAt,
    count: Object.keys(out).length,
    data: out,
  };

  await writeFile(
    new URL("../data/wx_live.json", import.meta.url),
    JSON.stringify(payload),
    "utf-8"
  );

  console.log(`Écrit data/wx_live.json — ${payload.count} terrains avec relevé.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
