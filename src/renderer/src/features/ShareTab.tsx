import type { Project } from '@shared/types'

export function ShareTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Share — {project.name}</p>
}
