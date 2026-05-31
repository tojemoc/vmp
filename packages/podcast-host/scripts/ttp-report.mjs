#!/usr/bin/env node
/**
 * Summarize VMP_TTP JSON lines from a log file or stdin.
 *
 * Usage:
 *   grep '^VMP_TTP' /var/log/vmp-pipeline.log | node scripts/ttp-report.mjs
 *   node scripts/ttp-report.mjs /var/log/vmp-ttp.jsonl
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const inputPath = process.argv[2]

async function readLines(onLine) {
  const stream = inputPath ? createReadStream(inputPath, 'utf8') : process.stdin
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) onLine(line)
}

const summaries = []

await readLines((line) => {
  if (!line.startsWith('VMP_TTP\t')) return
  const raw = line.slice('VMP_TTP\t'.length)
  try {
    const row = JSON.parse(raw)
    if (row.type === 'ttp_summary') summaries.push(row)
  } catch {
    // ignore malformed
  }
})

if (!summaries.length) {
  console.error('No ttp_summary rows found. Pipe lines starting with VMP_TTP.')
  process.exit(1)
}

console.log('videoId\tsource\tdurationSec\tminimalMs\tfullMs\ttotalMs\tminimalRatio\tfullRatio\tphase2AfterMinimalMs')
for (const s of summaries) {
  console.log([
    s.videoId ?? '',
    s.source ?? '',
    s.sourceDurationSec ?? '',
    s.minimalPublishReadyElapsedMs ?? '',
    s.fullRenditionsReadyElapsedMs ?? '',
    s.totalElapsedMs ?? '',
    s.minimalPublishReadyRatioOfSourceDuration ?? '',
    s.fullRenditionsReadyRatioOfSourceDuration ?? '',
    s.phase2AfterMinimalMs ?? '',
  ].join('\t'))
}
