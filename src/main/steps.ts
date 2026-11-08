import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_TYPES } from '../shared/catalog'
import type { CreateOptions, ProjectAction } from '../shared/types'

/**
 * One unit of work in a job. `command` runs in the platform shell, `run` runs in
 * Node, and `when` lets a step be skipped (e.g. `composer install` without a composer.json).
 */
export interface Step {
  title: string
  command?: string
  run?: () => Promise<void>
  when?: () => Promise<boolean>
  cwd?: string
}

/** Quotes a value for bash (POSIX) and PowerShell alike. */
export function q(value: string, win = process.platform === 'win32'): string {
  return `'${value.replace(/'/g, win ? "''" : `'\\''`)}'`
}

export function configFlags(o: CreateOptions, includeName = true): string {
  const flags: string[] = []
  if (includeName && o.name) flags.push(`--project-name=${q(o.name)}`)
  if (o.type) {
    flags.push(`--project-type=${q(o.type)}`)
    flags.push(`--docroot=${q(o.docroot || '.')}`)
  }
  flags.push(`--php-version=${q(o.php)}`, `--nodejs-version=${q(o.node)}`, `--webserver-type=${q(o.webserver)}`)
  if (o.db) flags.push(`--database=${q(o.db)}`)
  return flags.join(' ')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Steps that create, clone or adopt a project and start it with DDEV. */
export function createSteps(o: CreateOptions): Step[] {
  const steps: Step[] = []
  const at = (file: string): string => join(o.path, file)

  if (o.mode === 'clone') {
    const branch = o.branch ? `--branch ${q(o.branch)} ` : ''
    steps.push({ title: `Cloning ${o.repo}`, command: `git clone ${branch}${q(o.repo ?? '')} ${q(o.path)}` })
  } else if (o.mode === 'new') {
    steps.push({ title: `Creating folder ${o.path}`, run: async () => void (await mkdir(o.path, { recursive: true })) })
  }

  steps.push({ title: 'Configuring DDEV', command: `ddev config ${configFlags(o)}`, cwd: o.path })

  const type = PROJECT_TYPES.find((p) => p.value === o.type)
  if (o.mode === 'new') {
    if (o.scaffold && type?.scaffold) {
      if (o.type === 'wordpress') steps.push({ title: 'Starting the project', command: 'ddev start', cwd: o.path })
      steps.push({ title: `Installing ${type.label}`, command: type.scaffold.join(' '), cwd: o.path })
    } else if (o.type !== 'generic') {
      steps.push({
        title: 'Creating index.php',
        run: async () => {
          await mkdir(join(o.path, o.docroot || '.'), { recursive: true })
          const file = join(o.path, o.docroot || '.', 'index.php')
          if (!(await exists(file))) await writeFile(file, '<?php phpinfo();\n')
        }
      })
    }
  } else if (o.deps) {
    steps.push({
      title: 'Creating .env from .env.example',
      when: async () => (await exists(at('artisan'))) && !(await exists(at('.env'))) && (await exists(at('.env.example'))),
      run: () => copyFile(at('.env.example'), at('.env'))
    })
  }

  if (o.phpmyadmin) steps.push({ title: 'Adding phpMyAdmin', command: 'ddev add-on get ddev/ddev-phpmyadmin', cwd: o.path })
  steps.push({ title: 'Starting the project', command: 'ddev start', cwd: o.path })

  if (o.mode !== 'new' && o.deps) {
    steps.push({ title: 'composer install', command: 'ddev composer install', cwd: o.path, when: () => exists(at('composer.json')) })
    steps.push({
      title: 'Generating APP_KEY',
      command: 'ddev artisan key:generate',
      cwd: o.path,
      when: async () => {
        if (!(await exists(at('artisan')))) return false
        try {
          return !/^APP_KEY=.+/m.test(await readFile(at('.env'), 'utf8'))
        } catch {
          return true
        }
      }
    })
    steps.push({ title: 'npm install', command: 'ddev npm install', cwd: o.path, when: () => exists(at('package.json')) })
  }
  return steps
}

export function actionSteps(approot: string, action: ProjectAction): Step[] {
  const command = { start: 'ddev start', stop: 'ddev stop', restart: 'ddev restart', delete: 'ddev delete -Oy' }[action]
  return [{ title: command, command, cwd: approot }]
}
