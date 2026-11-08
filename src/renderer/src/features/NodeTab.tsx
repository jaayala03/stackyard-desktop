import type { Project } from '@shared/types'

export function NodeTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Node — {project.name}</p>
}
