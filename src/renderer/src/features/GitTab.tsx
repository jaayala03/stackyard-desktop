import type { Project } from '@shared/types'

export function GitTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Git — {project.name}</p>
}
