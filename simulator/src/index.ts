#!/usr/bin/env node
import { Command, Option } from 'commander';
import { run, type RunnerOptions, type Stats, type Topic } from './runner.js';

function parseCli(): RunnerOptions {
  const program = new Command();
  program
    .name('shopify-webhook-simulator')
    .description('Sends realistic Shopify webhook payloads to a local endpoint.')
    .option('-u, --url <url>', 'webhook endpoint', 'http://localhost:3000/webhooks')
    .option('-r, --rps <n>', 'events per second (steady mode)', (v) => parseFloat(v), 1)
    .option('-c, --concurrency <n>', 'max concurrent in-flight requests', (v) => parseInt(v, 10), 10)
    .option('-d, --duration <seconds>', 'stop after N seconds', (v) => parseFloat(v))
    .option('-n, --total <n>', 'stop after N events', (v) => parseInt(v, 10))
    .option('--burst <n>', 'fire N events as fast as possible, then exit', (v) => parseInt(v, 10))
    .addOption(new Option('--workload <mode>', 'workload preset').choices(['steady', 'stress']).default('steady'))
    .option('--topics <list>', 'comma-separated: orders,products,customers', 'orders')
    .option('--update-rate <n>', 'fraction of order events that progress an existing order [0..1]', (v) => parseFloat(v), 0.3)
    .option('--cancel-rate <n>', 'fraction of order events that cancel an existing order [0..1]', (v) => parseFloat(v), 0.05)
    .option('--duplicate-rate <n>', 'probability of duplicate delivery per event [0..1]', (v) => parseFloat(v), 0)
    .option('--drop-rate <n>', 'probability the webhook is silently dropped (entity still visible via backfill REST) [0..1]', (v) => parseFloat(v), 0)
    .option('--out-of-order', 'randomize delivery order (Shopify does not guarantee order)', false)
    .option('--backfill-port <n>', 'expose Shopify-shape Admin REST API on this port (orders.json, orders/{id}.json, orders/count.json)', (v) => parseInt(v, 10))
    .option('--shops <list>', 'comma-separated X-Shopify-Shop-Domain values', 'dtc-apparel.myshopify.com')
    .option('--api-version <v>', 'X-Shopify-API-Version header', '2024-10')
    .option('--seed <n>', 'faker seed (deterministic data)', (v) => parseInt(v, 10))
    .option('--dry-run', 'log payloads instead of sending', false)
    .option('-v, --verbose', 'log every request', false)
    .option('--inserts <n>', '[stress] orders/create count', (v) => parseInt(v, 10), 10_000)
    .option('--updates <n>', '[stress] orders/updated count', (v) => parseInt(v, 10), 5_000)
    .option('--cancels <n>', '[stress] cancellation count', (v) => parseInt(v, 10), 1_000);
  program.parse();
  return program.opts<RunnerOptions>();
}

function printStats(stats: Stats, label: string) {
  const elapsed = (Date.now() - stats.start) / 1000;
  const rps = stats.sent / Math.max(elapsed, 0.001);
  const rows = [...stats.byTopic.entries()]
    .sort(([a], [b]) => (a as Topic).localeCompare(b as Topic))
    .map(([t, n]) => `  ${String(t).padEnd(20)} ${n}`)
    .join('\n');
  console.log(`\n[${label}] sent=${stats.sent} ok=${stats.ok} failed=${stats.failed} dropped=${stats.dropped} elapsed=${elapsed.toFixed(2)}s rps=${rps.toFixed(1)}\n${rows}`);
}

async function main() {
  const opts = parseCli();
  const ac = new AbortController();
  let stopping = false;
  const onSignal = () => {
    if (stopping) {
      console.log('\nForcing exit.');
      process.exit(1);
    }
    stopping = true;
    console.log('\nShutting down (Ctrl+C again to force)...');
    ac.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  console.log(
    `[start] url=${opts.url} workload=${opts.workload} rps=${opts.rps} concurrency=${opts.concurrency} topics=${opts.topics} shops=${opts.shops}`,
  );

  const stats = await run(opts, {
    signal: ac.signal,
    onTick: (s) => printStats(s, 'tick'),
    onPhase: (p) => {
      if (p === 'stress') console.log('[stress] phases: inserts → updates → cancels');
    },
  });

  printStats(stats, 'final');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
