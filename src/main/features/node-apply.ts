import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NodePlan } from '../../shared/node'
import { ddevYaml, prepareScript, serviceUrl, viteWrapper } from './node-gen'
import { setupEnv } from './node-env'

/** Writes every generated file of the plan. Returns a human-readable report (lines). */
export async function applyPlan(plan: NodePlan, name: string, tld: string): Promise<string[]> {
  const ddevDir = join(plan.root, '.ddev')
  await mkdir(ddevDir, { recursive: true })
  await writeFile(join(ddevDir, 'config.stackyard.yaml'), ddevYaml(plan))
  const prep = join(ddevDir, 'stackyard-node-prepare.sh')
  await writeFile(prep, prepareScript(plan))
  await chmod(prep, 0o755).catch(() => undefined) // no-op on Windows; DDEV runs it with bash
  for (const s of plan.services) {
    if (s.kind === 'vite' && s.viteConfig) await writeFile(join(ddevDir, `vite.${s.name}.ddev.config.mjs`), viteWrapper(s, plan, tld))
  }
  const { notes, missing } = await setupEnv(plan, name, tld)

  const report = ['Services:']
  for (const s of plan.services) {
    const where = s.publicPort ? serviceUrl(name, tld, s.publicPort, plan.scheme) : '(background)'
    const pm2 = s.pm2 ? `  [pm2: ${s.pm2}]` : ''
    report.push(`  ${s.name.padEnd(10)} ${s.kind.padEnd(7)} ${s.dir.padEnd(12)} → ${where}${pm2}`)
  }
  report.push(
    `Node ${plan.node} · database: ${plan.database ?? 'none'}` +
      (plan.puppeteer ? ' · Chromium for Puppeteer' : '') +
      (plan.native.length ? ` · native modules: ${plan.native.join(', ')}` : '')
  )
  if (notes.length) report.push('Environment files:', ...notes.map((n) => `  ${n}`))
  if (missing.length) report.push('Fill these with real values (the app needs them for some features):', ...missing.map((m) => `  ${m}`))
  return report
}
