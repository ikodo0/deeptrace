import { createServer } from "node:http";

const port = Number(process.argv[2] ?? "18545");
const tip = 200;
const topic0 = "0x540e15f17778b95f45eb462185bc3a5774bd244524acfb8be672ab5980ddeb37";
const word = (value) => value.toString(16).padStart(64, "0");
const hash = (value) => `0x${word(value)}`;
const block = (number) => ({
  number: `0x${number.toString(16)}`,
  hash: hash(number + 10_000),
  parentHash: hash(number + 9_999),
  timestamp: `0x${(1_700_000_000 + number).toString(16)}`,
  transactions: [],
});

const server = createServer(async (request, response) => {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  const call = JSON.parse(text);
  let result;
  if (call.method === "eth_chainId") result = "0x1";
  else if (call.method === "eth_blockNumber") result = `0x${tip.toString(16)}`;
  else if (call.method === "eth_getBlockByNumber") {
    const tag = call.params[0];
    const number =
      tag === "latest" || tag === "finalized" || tag === "safe"
        ? tip
        : Number.parseInt(String(tag), 16);
    result = block(number);
  } else if (call.method === "eth_getLogs") {
    const filter = call.params[0];
    const from = Number.parseInt(filter.fromBlock ?? "0x0", 16);
    const to =
      filter.toBlock === "latest"
        ? tip
        : Number.parseInt(filter.toBlock ?? `0x${tip.toString(16)}`, 16);
    console.log(JSON.stringify({ method: "eth_getLogs", from, to }));
    result = Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => {
      const number = from + offset;
      return {
        address: "0x0000000000000000000000000000000000000001",
        topics: [topic0, `0x${word(2)}`],
        data: `0x${word(number)}${word(number)}`,
        blockNumber: `0x${number.toString(16)}`,
        transactionHash: hash(number + 20_000),
        transactionIndex: "0x0",
        blockHash: hash(number + 10_000),
        logIndex: "0x0",
        removed: false,
      };
    });
  } else if (call.method === "eth_getCode") result = "0x01";
  else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: call.id,
        error: { code: -32601, message: call.method },
      }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
});

server.listen(port, "127.0.0.1", () => console.log(`fake RPC listening on ${port}`));
