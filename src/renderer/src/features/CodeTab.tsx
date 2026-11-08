import type { Project } from '@shared/types'

export function CodeTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Code — {project.name}</p>
}
