const fs = require("fs");
const path = require("path");
const { id } = require("ethers");

const target = (process.argv[2] || "").toLowerCase();
if (!/^0x[0-9a-f]{8}$/.test(target)) {
  console.error("usage: node scripts/decodeSelector.js 0x05fbc1ae");
  process.exit(1);
}

function walk(dir, out=[]) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && ent.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const files = walk(path.join(process.cwd(), "artifacts"));

let hits = 0;
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
  const abi = j.abi;
  if (!Array.isArray(abi)) continue;

  for (const frag of abi) {
    if (frag.type !== "error") continue;
    const sig = `${frag.name}(${(frag.inputs || []).map(i => i.type).join(",")})`;
    const sel = id(sig).slice(0, 10).toLowerCase();
    if (sel === target) {
      console.log(`MATCH ${sel}  ${sig}  @ ${f}`);
      hits++;
    }
  }
}

if (!hits) console.log("No matches in artifacts. (Try scanning gmx-synthetics deployments ABI too.)");
