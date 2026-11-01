#!/usr/bin/env node
'use strict';

// Usage:
//   node src/cli.js run      one pipeline run against the sample data
//   node src/cli.js reset    delete demo state and output

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { buildApp } = require('./app');
const { runOnce } = require('./pipeline');

async function main() {
  const cmd = process.argv[2] || 'run';
  const config = loadConfig();

  if (cmd === 'reset') {
    fs.rmSync(config.stateDir, { recursive: true, force: true });
    fs.rmSync(config.outputDir, { recursive: true, force: true });
    console.log('Demo state and output removed.');
    return;
  }
  if (cmd !== 'run') {
    console.error(`Unknown command "${cmd}". Use "run" or "reset".`);
    process.exit(1);
  }

  const app = buildApp(config);
  console.log(
    [
      `Mode:        ${config.publishMode === 'wordpress' ? 'LIVE (publishes to WordPress)' : 'DEMO (nothing is published)'}`,
      `AI:          ${app.ai.name}`,
      `Publisher:   ${app.publisher.name}`,
      `Indexer:     ${app.indexer.name}`,
      config.liveBlockedReason ? `Note:        live publishing was requested but blocked (${config.liveBlockedReason})` : null,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n')
  );

  const report = await runOnce(app);
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(path.join(config.outputDir, 'run-report.json'), JSON.stringify(report, null, 2));

  const s = report.screening || {};
  const outDir = path.relative(process.cwd(), config.outputDir) || '.';
  console.log(
    [
      '',
      'Summary',
      `  Collected:      ${report.collected} candidates passed collection filters and screening (${report.unseen} not seen before)`,
      `  Screening:      ${s.ruleRejected} rejected by rules, ${s.aiRejected} rejected by AI, ${s.aiPassed} passed, ${s.cached} from cache`,
      `  AI problems:    ${s.heldBack} held back for retry, ${s.sentToReview} sent to manual review (${report.manualReviewQueue?.length ?? 0} in queue)`,
      `  Published:      ${report.published.length} this run (${report.dailyCount} today)`,
      `  Duplicates:     ${report.skipped.length} skipped`,
      `  Failed:         ${report.failed.length}${report.stuck.length ? `, moved to stuck list: ${report.stuck.join(', ')}` : ''}`,
      `  Network guard:  ${app.guard ? `${app.guard.blocked.length} request(s) blocked` : 'off (live publishing enabled)'}`,
      `  Output:         ${outDir}/posts/, indexing-requests.json, run-report.json`,
    ].join('\n')
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
