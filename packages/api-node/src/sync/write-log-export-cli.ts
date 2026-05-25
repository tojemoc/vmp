import { buildEnv, getDbAdapter } from '../env.js'
import { writeFileSync } from 'node:fs'

async function main(): Promise<void> {
  await buildEnv()
  const db = getDbAdapter()
  if (!db) throw new Error('Database not initialized')
  const out = process.argv[2] ?? `failover-write-log-${Date.now()}.sql`
  writeFileSync(out, db.exportWriteLogSql(), 'utf8')
  console.log(`Wrote ${db.getWriteLogPendingCount()} entries to ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
