// Types shared by the main process (Node project analysis) and the Node tab.

export type ServiceKind = 'server' | 'vite' | 'worker'
export type PackageManager = 'npm' | 'yarn' | 'pnpm'

export interface NodeService {
  name: string
  /** Folder relative to the project root ('.' for the root), always with forward slashes. */
  dir: string
  kind: ServiceKind
  /** Port the process listens on inside the container (0 for workers). */
  port: number
  command?: string
  viteConfig?: string | null
  pm: PackageManager
  native: string[]
  primary: boolean
  httpsPort: number | null
  httpPort: number | null
  publicPort: number | null
  /** pm2 app name when the service comes from a pm2 ecosystem file. */
  pm2?: string
}

export interface NodePlan {
  root: string
  scheme: 'https' | 'http'
  services: NodeService[]
  node: string
  database: string | null
  puppeteer: boolean
  native: string[]
  yarnOrPnpm: boolean
}

/** User edits kept in .ddev/stackyard-node.json so that re-applying does not lose them. */
export interface NodeOverrides {
  services?: Record<string, { command?: string; port?: number }>
}

export interface ViteStatus {
  /** File name of the vite config in the project root, if any. */
  config: string | null
  ddevReady: boolean
  viteReady: boolean
}

export interface NodeStatus {
  isNode: boolean
  /** .ddev/config.stackyard.yaml exists. */
  configured: boolean
  plan: NodePlan | null
  urls: Record<string, string>
  tld: string
  overrides: NodeOverrides
  vite: ViteStatus
}

export interface NodeResult {
  ok: boolean
  output: string
  /** Set by "Set up Vite" when vite.config could not be patched automatically. */
  snippet?: string
}
