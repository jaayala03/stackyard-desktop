import type { NodePlan } from '../../shared/node'
import type { CreateOptions } from '../../shared/types'
import { projectTld } from '../ddev'
import { q, type Step } from '../steps'
import { applyPlan } from './node-apply'
import { ddevConfigFlags, fallbackConfigFlags } from './node-gen'
import { analyze } from './node-plan'

/**
 * The "ddev config" part of project creation. Node projects (chosen, or detected when the type is
 * automatic) get the generated multi-service setup; the Node version picked in the dialog wins
 * over the detected one. Detection runs in Node, so no shell conditionals are needed.
 */
export function configureSteps(o: CreateOptions, plainFlags: string): Step[] {
  if (o.type && o.type !== 'node') {
    return [{ title: 'Configuring DDEV', command: `ddev config ${plainFlags}`, cwd: o.path }]
  }
  const explicit = o.type === 'node'
  const state: { plan: NodePlan | null } = { plan: null }
  const isNode = async (): Promise<boolean> => explicit || state.plan !== null
  const nameFlag = o.name ? `--project-name=${q(o.name)} ` : ''

  const steps: Step[] = [
    {
      title: 'Detecting the project type',
      run: async () => {
        state.plan = await analyze(o.path, o.scheme)
      }
    },
    {
      title: 'Configuring DDEV for Node (backend and frontend as services)',
      when: isNode,
      // read when the step runs, i.e. after the detection above
      get command(): string {
        return `ddev config ${nameFlag}${state.plan ? ddevConfigFlags(state.plan, o.node) : fallbackConfigFlags(o.node)}`
      },
      cwd: o.path
    },
    {
      title: 'Writing the Node services configuration',
      when: async () => state.plan !== null,
      run: async () => {
        if (state.plan) await applyPlan(state.plan, o.name, await projectTld())
      },
      cwd: o.path
    }
  ]
  if (!explicit) {
    steps.push({ title: 'Configuring DDEV', when: async () => !(await isNode()), command: `ddev config ${plainFlags}`, cwd: o.path })
  }
  return steps
}
