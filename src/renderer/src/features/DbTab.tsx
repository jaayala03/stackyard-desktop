import type { Project } from '@shared/types'

export function DbTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Db — {project.name}</p>
}
