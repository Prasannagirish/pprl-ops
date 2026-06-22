import { processPendingSyncs } from "@/lib/sheets/sync";

async function main() {
  const result = await processPendingSyncs(Number(process.env.SYNC_BATCH_SIZE || 50));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
