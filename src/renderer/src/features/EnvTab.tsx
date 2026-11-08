import type { Project } from '@shared/types'

export function EnvTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Env — {project.name}</p>
}
