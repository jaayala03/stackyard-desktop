import type { Project } from '@shared/types'

export function DeployTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Deploy — {project.name}</p>
}
