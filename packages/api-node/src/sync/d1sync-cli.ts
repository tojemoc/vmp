/**
 * One-shot D1 sync: npm run sync:now --workspace=@vmp/api-node
 */
import { buildEnv, getDbAdapter, toNodeEnv } from '../env.js'
import { syncD1ToLocal } from './d1sync.js'

const once = process.argv.includes('--once') || !process.argv.includes('--watch')

async function main(): Promise<void> {
  await buildEnv()
  const db = getDbAdapter()
  if (!db) throw new Error('Database adapter not initialized')
  const result = await syncD1ToLocal(toNodeEnv(await buildEnv()), db)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
  if (once) process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
