const fs = require("fs");

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function decodeSourceCode(sourceCode) {
  if (!sourceCode || !sourceCode.trim()) {
    return "";
  }

  const trimmed = sourceCode.trim();

  // Etherscan/Snowtrace multi-file format is often wrapped as {{...}}
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    const parsed = JSON.parse(trimmed.slice(1, -1));
    if (parsed && parsed.sources && typeof parsed.sources === "object") {
      return Object.entries(parsed.sources)
        .map(([file, content]) => {
          const body = content && typeof content.content === "string" ? content.content : "";
          return `// === ${file} ===\n${body}`;
        })
        .join("\n\n");
    }
  }

  // Standard JSON input format may also appear without double-brace wrapping
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.sources && typeof parsed.sources === "object") {
        return Object.entries(parsed.sources)
          .map(([file, content]) => {
            const body = content && typeof content.content === "string" ? content.content : "";
            return `// === ${file} ===\n${body}`;
          })
          .join("\n\n");
      }
    } catch {
      // fall through to raw source text
    }
  }

  return sourceCode;
}

function buildCandidateUrls(chain, address) {
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY || "YourApiKeyToken";
  const arbiscanApiKey = process.env.ARBISCAN_API_KEY || etherscanApiKey;
  const snowtraceApiKey = process.env.SNOWTRACE_API_KEY || etherscanApiKey;

  if (chain === "arbitrum") {
    return [
      `https://api.etherscan.io/v2/api?chainid=42161&module=contract&action=getsourcecode&address=${address}&apikey=${etherscanApiKey}`,
      `https://api.arbiscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${arbiscanApiKey}`
    ];
  }

  return [
    `https://api.etherscan.io/v2/api?chainid=43114&module=contract&action=getsourcecode&address=${address}&apikey=${etherscanApiKey}`,
    `https://api.snowtrace.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${snowtraceApiKey}`
  ];
}

async function getContractMeta(chain, address) {
  const urls = buildCandidateUrls(chain, address);
  let lastError = "unknown";

  for (const url of urls) {
    try {
      const json = await fetchJson(url);
      const ok = json && json.status === "1" && Array.isArray(json.result) && json.result[0];
      if (ok) {
        return json.result[0];
      }
      lastError = JSON.stringify(json).slice(0, 300);
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }
  }

  throw new Error(`${chain} source API returned unexpected payload for ${address}: ${lastError}`);
}

async function resolveAndFetch(chain, address) {
  try {
    const first = await getContractMeta(chain, address);
    const isProxy = first.IsProxy === "1";
    const implementation = (first.Implementation || "").trim();

    let finalAddress = address;
    let meta = first;

    if (isProxy && implementation) {
      finalAddress = implementation;
      meta = await getContractMeta(chain, finalAddress);
    }

    const source = decodeSourceCode(meta.SourceCode || "");

    return {
      chain,
      inputAddress: address,
      isProxy,
      implementation: implementation || "N/A",
      finalAddress,
      contractName: meta.ContractName || "",
      compilerVersion: meta.CompilerVersion || "",
      source,
      error: ""
    };
  } catch (error) {
    return {
      chain,
      inputAddress: address,
      isProxy: false,
      implementation: "N/A",
      finalAddress: address,
      contractName: "",
      compilerVersion: "",
      source: "",
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function main() {
  const arbAddress = process.env.ORACLESTORE_ARB || "0xA8AF9B86fC47deAde1bc66B12673706615E2B011";
  const avaAddress = process.env.ORACLESTORE_AVA || "0xA6aC2e08C6d6bbD9B237e0DaaEcd7577996f4e84";

  const arb = await resolveAndFetch("arbitrum", arbAddress);
  const ava = await resolveAndFetch("avalanche", avaAddress);

  fs.writeFileSync("outputs/oracle-store-arb.sol", arb.source || "", "utf8");
  fs.writeFileSync("outputs/oracle-store-ava.sol", ava.source || "", "utf8");

  const meta = {
    arbitrum: {
      inputAddress: arb.inputAddress,
      isProxy: arb.isProxy,
      implementation: arb.implementation,
      finalAddress: arb.finalAddress,
      contractName: arb.contractName,
      compilerVersion: arb.compilerVersion,
      sourceLength: (arb.source || "").length
    },
    avalanche: {
      inputAddress: ava.inputAddress,
      isProxy: ava.isProxy,
      implementation: ava.implementation,
      finalAddress: ava.finalAddress,
      contractName: ava.contractName,
      compilerVersion: ava.compilerVersion,
      sourceLength: (ava.source || "").length
    }
  };

  fs.writeFileSync("outputs/oracle-store-meta.json", JSON.stringify(meta, null, 2), "utf8");

  if (arb.error || ava.error) {
    const summary = [
      "FETCH_INCOMPLETE",
      `ARB_ERROR=${arb.error || ""}`,
      `AVA_ERROR=${ava.error || ""}`,
      `ARB_LEN=${(arb.source || "").length}`,
      `AVA_LEN=${(ava.source || "").length}`
    ].join("\n") + "\n";
    fs.writeFileSync("outputs/oracle-store-diff.txt", summary, "utf8");
    console.log("Source fetch incomplete; see outputs/oracle-store-diff.txt and outputs/oracle-store-meta.json");
  } else if ((arb.source || "") === (ava.source || "")) {
    fs.writeFileSync("outputs/oracle-store-diff.txt", "IDENTICAL_SOURCE\n", "utf8");
    console.log("OracleStore sources are identical across fetched targets.");
  } else {
    const summary = `DIFFERENT_SOURCE\nARB_LEN=${(arb.source || "").length}\nAVA_LEN=${(ava.source || "").length}\n`;
    fs.writeFileSync("outputs/oracle-store-diff.txt", summary, "utf8");
    console.log("OracleStore sources differ; see outputs/oracle-store-diff.txt");
  }

  console.log(JSON.stringify(meta, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
