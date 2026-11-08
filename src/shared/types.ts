export type ProjectStatus = 'running' | 'stopped' | 'paused' | string

export interface Project {
  name: string
  status: ProjectStatus
  approot: string
  type: string
  primaryUrl: string
  httpUrl: string
  httpsUrl: string
  docroot: string
  php: string
  node: string
  webserver: string
  db: string
}

export type CreateMode = 'new' | 'clone' | 'existing'

export interface CreateOptions {
  mode: CreateMode
  name: string
  path: string
  repo?: string
  branch?: string
  type: string
  docroot: string
  php: string
  node: string
  webserver: string
  db: string
  scheme: 'https' | 'http'
  scaffold: boolean
  deps: boolean
  phpmyadmin: boolean
  launch: boolean
}

export type Language = 'auto' | 'en' | 'es'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  language: Language
  theme: Theme
  projectsDir: string
}

export type ProjectAction = 'start' | 'stop' | 'restart' | 'delete'

export interface ToolStatus {
  ddev: boolean
  docker: boolean
  ddevVersion: string
}

export interface TermSession {
  id: string
  title: string
  kind: 'job' | 'shell'
  running: boolean
}

export interface Api {
  platform: string
  /** Generic bridge used by feature modules (git, code, env…): `invoke('git:status', approot)`. */
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  settings: { get(): Promise<Settings>; set(s: Partial<Settings>): Promise<Settings> }
  system: { tools(): Promise<ToolStatus>; systemLocale(): Promise<string> }
  projects: {
    list(): Promise<Project[]>
    action(name: string, approot: string, action: ProjectAction): Promise<TermSession>
    create(options: CreateOptions): Promise<TermSession>
    detectType(path: string): Promise<{ type: string; docroot: string }>
    ssh(approot: string, name: string): Promise<TermSession>
    logs(approot: string, name: string): Promise<TermSession>
  }
  shell: {
    openUrl(url: string): Promise<void>
    openPath(path: string): Promise<void>
    openEditor(path: string): Promise<boolean>
    pickDirectory(): Promise<string | null>
  }
  term: {
    attach(id: string): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, code: number) => void): () => void
  }
}
